import { and, count, desc, eq } from 'drizzle-orm'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import type { Tx } from '~/server/audit'
import { writeAudit } from '~/server/audit'
import type { CurrentUser } from '~/server/auth'
import type { Db } from '~/server/db'
import { passkeys } from '~/server/db/schema'
import type { PasskeyRow } from '~/server/db/schema'
import type { PasskeySummary } from './register'

// Listing and removing passkeys (spec §11 Passkeys; the admin's removal: Jakub, 2026-11-18).
// A removed passkey's row is deleted; the audit log keeps who removed which one and when.

const SUMMARY = {
  id: passkeys.id,
  deviceKind: passkeys.deviceKind,
  createdAt: passkeys.createdAt,
  lastUsedAt: passkeys.lastUsedAt,
  backedUp: passkeys.backedUp,
}

/** One user's passkeys, newest first. Named columns only. */
export function listPasskeys(db: Db | Tx, userId: number): PasskeySummary[] {
  return db
    .select(SUMMARY)
    .from(passkeys)
    .where(eq(passkeys.userId, userId))
    .orderBy(desc(passkeys.id))
    .all()
}

const removedBefore = (p: PasskeyRow) => ({
  userId: p.userId,
  deviceKind: p.deviceKind,
  createdAt: p.createdAt,
})

/** Removes one of the caller's own passkeys. Someone else's reads as not found. */
export function removePasskey(
  db: Db,
  by: CurrentUser,
  passkeyId: number,
  now: Date,
): Result<undefined, 'not_found'> {
  const removed = db.transaction((tx) => {
    const row = tx
      .delete(passkeys)
      .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, by.id)))
      .returning()
      .get()
    if (!row) return false
    writeAudit(tx, {
      actor: { kind: 'user', userId: by.id },
      action: 'passkey.removed',
      entityType: 'passkey',
      entityId: row.id,
      before: removedBefore(row),
      at: now,
    })
    return true
  })
  return removed ? ok(undefined) : fail('not_found')
}

/**
 * The admin removes every passkey of one user (a lost phone). The role check is the server
 * function's guard. Returns how many were removed.
 */
export function removeUserPasskeys(db: Db, by: CurrentUser, userId: number, now: Date): number {
  return db.transaction((tx) => {
    const rows = tx.delete(passkeys).where(eq(passkeys.userId, userId)).returning().all()
    for (const row of rows) {
      writeAudit(tx, {
        actor: { kind: 'user', userId: by.id },
        action: 'passkey.removed',
        entityType: 'passkey',
        entityId: row.id,
        before: removedBefore(row),
        reason: 'admin',
        at: now,
      })
    }
    return rows.length
  })
}

/** How many passkeys each user has. Users with none are left out. */
export function countPasskeysByUser(db: Db | Tx): Record<number, number> {
  const rows = db
    .select({ userId: passkeys.userId, n: count() })
    .from(passkeys)
    .groupBy(passkeys.userId)
    .all()
  return Object.fromEntries(rows.map((r) => [r.userId, r.n]))
}
