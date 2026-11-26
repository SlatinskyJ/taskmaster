import { createHmac, timingSafeEqual } from 'node:crypto'
import { max } from 'drizzle-orm'
import type { CurrentUser } from '~/server/auth'
import { sessionToken } from '~/server/auth/http'
import type { Db } from '~/server/db'
import { getDb } from '~/server/db'
import { auditLog } from '~/server/db/schema'
import { getFlags } from '~/server/features'
import { ROLES } from '~/domain/parties'
import type { UserRole } from '~/server/db/schema'
import { isTopic, TOPIC_LIMIT } from './topics'
import type { Topic } from './topics'

// Signed subscriptions (#299): a data function returns the topics it read, signed by the server
// with the request's session token as the HMAC key. The stream (./stream.ts) accepts only
// tokens it can verify with the stream request's own session token, so a stream carries only
// topics this login's own data functions issued, and a token copied to another login is void.

/** What a data function returns next to its data. */
export interface LiveSub {
  token: string
  /** The newest audit id when the data was read: the stream replays changes after it. */
  asOf: number
}

export interface Subscription {
  userId: number
  /** The role the viewer had when the data was read: the stream refuses it under another. */
  role: UserRole
  topics: Topic[]
  asOf: number
}

const isId = (v: unknown, min: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min

function mac(key: string, payload: string): Buffer {
  return createHmac('sha256', key).update(payload).digest()
}

const isRole = (v: unknown): v is UserRole =>
  typeof v === 'string' && (ROLES as readonly string[]).includes(v)

/** `base64url(JSON {u, r, t, a}).base64url(HMAC-SHA256)`. Throws on a topic list a screen got wrong. */
export function signSubscription(
  key: string,
  user: { id: number; role: UserRole },
  topics: readonly Topic[],
  asOf: number,
): string {
  if (topics.length > TOPIC_LIMIT) {
    throw new Error(`live: ${String(topics.length)} topics, at most ${String(TOPIC_LIMIT)}`)
  }
  for (const t of topics) if (!isTopic(t)) throw new Error(`live: not a topic: ${String(t)}`)
  const payload = Buffer.from(
    JSON.stringify({ u: user.id, r: user.role, t: topics, a: asOf }),
  ).toString('base64url')
  return `${payload}.${mac(key, payload).toString('base64url')}`
}

/** The subscription in a token signed with `key`, or null for any token that is not exactly that. */
export function readSubscription(key: string, token: string): Subscription | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payload = '', sig = ''] = parts
  const want = mac(key, payload)
  const got = Buffer.from(sig, 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  let data: unknown
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (data === null || typeof data !== 'object') return null
  const { u, r, t, a } = data as Record<string, unknown>
  if (!isId(u, 1) || !isRole(r) || !isId(a, 0) || !Array.isArray(t) || t.length > TOPIC_LIMIT)
    return null
  const topics: Topic[] = []
  for (const s of t) {
    if (typeof s !== 'string' || !isTopic(s)) return null
    topics.push(s)
  }
  return { userId: u, role: r, topics, asOf: a }
}

/** The newest audit id now (0 for an empty log). */
export function newestAuditId(db: Db): number {
  return (
    db
      .select({ id: max(auditLog.id) })
      .from(auditLog)
      .get()?.id ?? 0
  )
}

/** `liveSubscription`'s body, with what it reads from the request passed in. */
export function liveSubscriptionIn(
  db: Db,
  key: string | undefined,
  user: CurrentUser,
  topics: readonly Topic[],
): LiveSub | null {
  if (!key || !getFlags(db).liveChanges) return null
  const asOf = newestAuditId(db)
  return { token: signSubscription(key, user, topics, asOf), asOf }
}

/**
 * The live subscription for what a data function read, or null (switch off, or no session).
 * Call it **before** the function's reads, or in the same synchronous block: a change committed
 * during an `await` between `asOf` and the reads would otherwise be missed (an early `asOf`
 * only over-fires).
 */
export function liveSubscription(user: CurrentUser, topics: readonly Topic[]): LiveSub | null {
  return liveSubscriptionIn(getDb(), sessionToken(), user, topics)
}
