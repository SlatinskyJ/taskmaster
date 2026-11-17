import { and, count, eq, gt, lte } from 'drizzle-orm'
import { toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { loginFailures } from '~/server/db/schema'

// Login rate limit (spec §6, §11 Auth) [call]: failed logins in the last 15 minutes, counted
// per username and per client IP. Over either limit, the login is refused without checking the
// password, and the refusal itself doesn't count (so waiting always helps). A success clears
// that username's failures, not the IP's.

export const FAILURE_WINDOW_MS = 15 * 60 * 1000
/** A child mistyping gets 10 tries per 15 minutes. */
export const MAX_FAILURES_PER_USER = 10
/** Several family members share one home IP. */
export const MAX_FAILURES_PER_IP = 30

export interface LimitKeys {
  user: string
  ip: string
}

export function limitKeys(username: string, ip: string): LimitKeys {
  return { user: `user:${username}`, ip: `ip:${ip}` }
}

/** True when either key is over its limit. Prunes failures older than the window first. */
export function isRateLimited(db: Db | Tx, keys: LimitKeys, now: Date): boolean {
  const since = toIsoUtc(new Date(now.getTime() - FAILURE_WINDOW_MS))
  db.delete(loginFailures).where(lte(loginFailures.at, since)).run()
  const failures = (key: string) =>
    db
      .select({ n: count() })
      .from(loginFailures)
      .where(and(eq(loginFailures.key, key), gt(loginFailures.at, since)))
      .get()?.n ?? 0
  return failures(keys.user) >= MAX_FAILURES_PER_USER || failures(keys.ip) >= MAX_FAILURES_PER_IP
}

export function recordFailure(tx: Db | Tx, keys: LimitKeys, now: Date): void {
  const at = toIsoUtc(now)
  tx.insert(loginFailures)
    .values([
      { key: keys.user, at },
      { key: keys.ip, at },
    ])
    .run()
}

export function clearUserFailures(tx: Db | Tx, keys: LimitKeys): void {
  tx.delete(loginFailures).where(eq(loginFailures.key, keys.user)).run()
}
