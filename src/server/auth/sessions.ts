import { createHash, randomBytes } from 'node:crypto'
import { eq, lte } from 'drizzle-orm'
import { parseIsoUtc, toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { sessions, users } from '~/server/db/schema'
import type { SessionMethod, SessionRow, UserRole } from '~/server/db/schema'

// Sessions (spec §11 Auth, Sessions [call]): a random 256-bit token in the cookie, its SHA-256
// in the DB. Sliding expiry: about 90 days after the last use. To keep writes rare, use moves
// the expiry forward at most once a day.

export const SESSION_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000
const SESSION_MS = SESSION_DAYS * DAY_MS
/** How stale `lastSeenAt` may get before a request renews the session. */
export const RENEW_AFTER_MS = DAY_MS

/** 32 random bytes, base64url: 43 characters. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/

/** Who is signed in, as server code and screens see them. Never carries the hash. */
export interface CurrentUser {
  id: number
  username: string
  displayName: string
  role: UserRole
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function expiryFrom(at: Date): Date {
  return new Date(at.getTime() + SESSION_MS)
}

/** Opens a session inside the caller's transaction. The token goes to the cookie only. */
export function createSession(
  tx: Db | Tx,
  userId: number,
  method: SessionMethod,
  now: Date,
): { token: string; session: SessionRow } {
  const token = randomBytes(32).toString('base64url')
  const at = toIsoUtc(now)
  const session = tx
    .insert(sessions)
    .values({
      tokenHash: hashToken(token),
      userId,
      method,
      createdAt: at,
      lastSeenAt: at,
      expiresAt: toIsoUtc(expiryFrom(now)),
    })
    .returning()
    .get()
  return { token, session }
}

export interface ResolvedSession {
  session: SessionRow
  user: CurrentUser
  /** The expiry moved forward: the cookie must be sent again with the new date. */
  renewed: boolean
}

/**
 * The session and user behind a cookie token, or null when the token is unknown, expired, or
 * its user is inactive. An expired session is deleted on sight.
 */
export function resolveSession(db: Db, token: string, now: Date): ResolvedSession | null {
  if (!TOKEN_SHAPE.test(token)) return null
  const row = db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .get()
  if (!row) return null
  if (parseIsoUtc(row.session.expiresAt) <= now) {
    db.delete(sessions).where(eq(sessions.id, row.session.id)).run()
    return null
  }
  if (!row.user.active) return null
  const user: CurrentUser = {
    id: row.user.id,
    username: row.user.username,
    displayName: row.user.displayName,
    role: row.user.role,
  }
  if (now.getTime() - parseIsoUtc(row.session.lastSeenAt).getTime() < RENEW_AFTER_MS) {
    return { session: row.session, user, renewed: false }
  }
  const session = db
    .update(sessions)
    .set({ lastSeenAt: toIsoUtc(now), expiresAt: toIsoUtc(expiryFrom(now)) })
    .where(eq(sessions.id, row.session.id))
    .returning()
    .get()
  return { session, user, renewed: true }
}

/** The session behind a token, without touching it (logout reads it before deleting). */
export function findSession(db: Db | Tx, token: string): SessionRow | undefined {
  if (!TOKEN_SHAPE.test(token)) return undefined
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .get()
}

export function deleteSession(tx: Db | Tx, sessionId: number): void {
  tx.delete(sessions).where(eq(sessions.id, sessionId)).run()
}

/** Ends every session of a user (password reset, spec §6). Returns how many ended. */
export function endUserSessions(tx: Db | Tx, userId: number): number {
  return tx.delete(sessions).where(eq(sessions.userId, userId)).run().changes
}

/** Deletes sessions past their expiry. Called on login, so the table can't grow forever. */
export function pruneExpiredSessions(tx: Db | Tx, now: Date): void {
  tx.delete(sessions)
    .where(lte(sessions.expiresAt, toIsoUtc(now)))
    .run()
}
