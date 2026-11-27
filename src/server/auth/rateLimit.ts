import { createHash } from 'node:crypto'
import { and, count, eq, gt, lte } from 'drizzle-orm'
import { toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { loginFailures } from '~/server/db/schema'
import { ipBucket } from './clientIp'

// Login rate limit (spec §6, §11 Auth) [call]: failed logins in the last 15 minutes, counted
// per username and per client IP. Over either limit, the login is refused without checking the
// password, and the refusal itself doesn't count (so waiting always helps). A success clears
// that username's failures, not the IP's (except its own attempt).

export const FAILURE_WINDOW_MS = 15 * 60 * 1000
/** A child mistyping gets 10 tries per 15 minutes. */
export const MAX_FAILURES_PER_USER = 10
/** Several family members share one home IP. */
export const MAX_FAILURES_PER_IP = 30
/**
 * The public demo only: every attempt from one IP in the window, right or wrong, counted under
 * `demo-ip:<ip>` and never taken back. There the demo family's names skip the per-username
 * limit (one visitor's typos must not lock them for the next), so this caps password guessing
 * from one IP instead.
 */
export const DEMO_ATTEMPTS_PER_IP = 60

export interface LimitKeys {
  user: string
  ip: string
  /** The public demo's attempt cap: the IP's bucket (an IPv6 /64, see ./clientIp `ipBucket`). */
  demoIp: string
}

/**
 * The name is stored hashed: people type their password into the name field, and the table
 * would keep it for 15 minutes.
 */
export function limitKeys(username: string, ip: string): LimitKeys {
  return {
    user: `user:${createHash('sha256').update(username).digest('hex')}`,
    ip: `ip:${ip}`,
    demoIp: `demo-ip:${ipBucket(ip)}`,
  }
}

const windowStart = (now: Date) => toIsoUtc(new Date(now.getTime() - FAILURE_WINDOW_MS))

function failures(db: Db | Tx, key: string, now: Date): number {
  return (
    db
      .select({ n: count() })
      .from(loginFailures)
      .where(and(eq(loginFailures.key, key), gt(loginFailures.at, windowStart(now))))
      .get()?.n ?? 0
  )
}

/** One attempt counted in advance, so it can be taken back if the password turns out right. */
export interface Attempt {
  keys: LimitKeys
  ipRowId: number
}

/** The public demo's changes to the limits (login.ts sets them only there). */
export interface ReserveOptions {
  /** Skip the per-username limit (the demo family's names on the demo). */
  skipUser?: boolean
  /** Also count against DEMO_ATTEMPTS_PER_IP. */
  demoIp?: boolean
}

/**
 * Counts this attempt as a failure up front, in one synchronous transaction, or returns null
 * when either key is already at its limit. Counting before the (async) password check means a
 * burst of parallel tries can't all slip past the check. Also prunes failures older than the
 * window. A refusal is not counted, so waiting always helps.
 */
export function reserveAttempt(
  db: Db,
  keys: LimitKeys,
  now: Date,
  opts: ReserveOptions = {},
): Attempt | null {
  return db.transaction((tx) => {
    tx.delete(loginFailures)
      .where(lte(loginFailures.at, windowStart(now)))
      .run()
    if (
      (!opts.skipUser && failures(tx, keys.user, now) >= MAX_FAILURES_PER_USER) ||
      failures(tx, keys.ip, now) >= MAX_FAILURES_PER_IP ||
      (opts.demoIp === true && failures(tx, keys.demoIp, now) >= DEMO_ATTEMPTS_PER_IP)
    ) {
      return null
    }
    const at = toIsoUtc(now)
    if (opts.demoIp) tx.insert(loginFailures).values({ key: keys.demoIp, at }).run()
    tx.insert(loginFailures).values({ key: keys.user, at }).run()
    const ip = tx.insert(loginFailures).values({ key: keys.ip, at }).returning().get()
    return { keys, ipRowId: ip.id }
  })
}

/** A right password: clears the name's failures and takes back this attempt's IP count. */
export function releaseAttempt(tx: Db | Tx, attempt: Attempt): void {
  tx.delete(loginFailures).where(eq(loginFailures.key, attempt.keys.user)).run()
  tx.delete(loginFailures).where(eq(loginFailures.id, attempt.ipRowId)).run()
}
