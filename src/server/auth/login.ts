import { eq } from 'drizzle-orm'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { writeAudit } from '~/server/audit'
import type { Db } from '~/server/db'
import { users } from '~/server/db/schema'
import { dummyHash, MAX_PASSWORD_LENGTH, verifyPassword } from './password'
import { clearUserFailures, isRateLimited, limitKeys, recordFailure } from './rateLimit'
import type { CurrentUser } from './sessions'
import { createSession, deleteSession, findSession, pruneExpiredSessions } from './sessions'

// Password login and logout (spec §6, §11 Auth). Framework-free apart from the DB, so tests
// call these directly; ./http wires them to cookies and the request.

export type LoginError =
  /** Wrong username or password, or an inactive account: one answer, so nobody learns which. */
  | 'invalid_credentials'
  /** Too many failures for this username or IP in the last 15 minutes. */
  | 'rate_limited'

export interface LoginInput {
  username: string
  password: string
  /** Client IP as seen by the server (see ./http `clientIp`). */
  ip: string
}

export interface LoginSuccess {
  /** Goes to the cookie, nowhere else. */
  token: string
  expiresAt: Date
  user: CurrentUser
}

const MAX_USERNAME_LENGTH = 64

/** Why a failure happened, for the audit log only; the caller always sees `invalid_credentials`. */
type FailureReason = 'unknown_user' | 'wrong_password' | 'inactive'

export async function login(
  db: Db,
  input: LoginInput,
  now: Date = new Date(),
): Promise<Result<LoginSuccess, LoginError>> {
  const username = input.username.trim().toLowerCase().slice(0, MAX_USERNAME_LENGTH)
  const keys = limitKeys(username, input.ip)
  if (isRateLimited(db, keys, now)) return fail('rate_limited')

  const user = db.select().from(users).where(eq(users.username, username)).get()
  const tooLong = input.password.length > MAX_PASSWORD_LENGTH
  // Always verify something, so an unknown username costs the same time as a wrong password.
  const matches =
    !tooLong && (await verifyPassword(user?.passwordHash ?? dummyHash(), input.password))
  const reason: FailureReason | null = !user
    ? 'unknown_user'
    : !matches || user.passwordHash === null
      ? 'wrong_password'
      : !user.active
        ? 'inactive'
        : null

  if (reason !== null || !user) {
    db.transaction((tx) => {
      recordFailure(tx, keys, now)
      writeAudit(tx, {
        actor: { kind: 'anonymous' },
        action: 'auth.login_failed',
        entityType: 'user',
        // An unknown name is not logged: people type passwords into the username field.
        entityId: user ? user.id : 'unknown',
        after: { reason: reason ?? 'unknown_user', ip: input.ip },
        at: now,
      })
    })
    return fail('invalid_credentials')
  }

  const { token, session } = db.transaction((tx) => {
    clearUserFailures(tx, keys)
    pruneExpiredSessions(tx, now)
    const opened = createSession(tx, user.id, 'password', now)
    writeAudit(tx, {
      actor: { kind: 'user', userId: user.id },
      action: 'auth.login_succeeded',
      entityType: 'session',
      entityId: opened.session.id,
      after: { method: opened.session.method, ip: input.ip },
      at: now,
    })
    return opened
  })
  return ok({
    token,
    expiresAt: new Date(session.expiresAt),
    user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
  })
}

/** Ends the session behind `token`. Unknown or already-ended tokens do nothing. */
export function logout(db: Db, token: string, now: Date = new Date()): void {
  db.transaction((tx) => {
    const session = findSession(tx, token)
    if (!session) return
    deleteSession(tx, session.id)
    writeAudit(tx, {
      actor: { kind: 'user', userId: session.userId },
      action: 'auth.logout',
      entityType: 'session',
      entityId: session.id,
      before: { method: session.method, createdAt: session.createdAt },
      at: now,
    })
  })
}
