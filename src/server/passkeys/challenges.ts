import { createHash, randomBytes } from 'node:crypto'
import { isIPv4, isIPv6 } from 'node:net'
import { and, count, eq, isNotNull, lte } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import { hashToken } from '~/server/auth/sessions'
import type { Db } from '~/server/db'
import { passkeyChallenges } from '~/server/db/schema'
import type { ChallengePurpose } from '~/server/db/schema'

// WebAuthn challenges (spec §11 Passkeys), kept server-side and used once. The browser holds a
// random token in a short-lived cookie (./http); the DB keeps its hash, the challenge, and who
// or where it was issued for. Expired rows are pruned on every issue. Challenges are not state
// the audit log tracks (like login_failures), so neither issuing nor pruning writes an entry.
//
// Caps, so an anonymous flood can't fill the table: login challenges are limited per client IP
// (an IPv6 client counts by its /64) and in total; registration challenges, which need a
// signed-in user, are limited per user and don't count toward either. Flooding from about 25
// addresses at once can still make passkey login answer `busy` for up to 5 minutes; password
// login is not affected.

export const CHALLENGE_TTL_MS = 5 * 60 * 1000
export const MAX_LOGIN_CHALLENGES_PER_IP = 20
export const MAX_LOGIN_CHALLENGES = 500
export const MAX_REGISTER_CHALLENGES_PER_USER = 5

export type ChallengeFor =
  { purpose: 'login'; ip: string } | { purpose: 'register'; userId: number; userHandle: string }

export interface ConsumedChallenge {
  challenge: string
  userId: number | null
  userHandle: string | null
}

/** 32 random bytes, base64url: 43 characters. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/

/**
 * The part of an address that names one client: an IPv4 address whole, an IPv6 address cut to
 * its /64 (one home or phone usually holds a whole /64). An IPv4-mapped IPv6 counts as IPv4.
 * Anything else is returned as it is.
 */
export function ipPrefix(ip: string): string {
  const bare = ip.split('%')[0] ?? ip
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare)
  if (mapped?.[1] && isIPv4(mapped[1])) return mapped[1]
  if (!isIPv6(bare)) return ip
  const [head = '', tail] = bare.toLowerCase().split('::')
  const left = head === '' ? [] : head.split(':')
  const right = tail === undefined || tail === '' ? [] : tail.split(':')
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')
    .concat('::/64')
}

const ipKey = (ip: string) => createHash('sha256').update(ipPrefix(ip)).digest('hex')

/**
 * Stores a new challenge, or returns null when a cap is reached. `token` goes to the cookie
 * only; `challenge` goes into the WebAuthn options.
 */
export function issueChallenge(
  db: Db,
  issue: ChallengeFor,
  now: Date,
): { token: string; challenge: string } | null {
  return db.transaction((tx) => {
    tx.delete(passkeyChallenges)
      .where(lte(passkeyChallenges.expiresAt, toIsoUtc(now)))
      .run()
    const countWhere = (cond: SQL | undefined) =>
      tx.select({ n: count() }).from(passkeyChallenges).where(cond).get()?.n ?? 0
    let key: string | null = null
    if (issue.purpose === 'login') {
      key = ipKey(issue.ip)
      if (countWhere(eq(passkeyChallenges.ipKey, key)) >= MAX_LOGIN_CHALLENGES_PER_IP) return null
      if (
        countWhere(
          and(eq(passkeyChallenges.purpose, 'login'), isNotNull(passkeyChallenges.ipKey)),
        ) >= MAX_LOGIN_CHALLENGES
      ) {
        return null
      }
    } else if (
      countWhere(
        and(eq(passkeyChallenges.purpose, 'register'), eq(passkeyChallenges.userId, issue.userId)),
      ) >= MAX_REGISTER_CHALLENGES_PER_USER
    ) {
      return null
    }
    const token = randomBytes(32).toString('base64url')
    const challenge = randomBytes(32).toString('base64url')
    tx.insert(passkeyChallenges)
      .values({
        tokenHash: hashToken(token),
        challenge,
        purpose: issue.purpose,
        userId: issue.purpose === 'register' ? issue.userId : null,
        userHandle: issue.purpose === 'register' ? issue.userHandle : null,
        ipKey: key,
        expiresAt: toIsoUtc(new Date(now.getTime() + CHALLENGE_TTL_MS)),
      })
      .run()
    return { token, challenge }
  })
}

/**
 * The challenge behind `token`, used up: the row is deleted whenever it is found, even when it
 * expired or was issued for the other purpose. Null when unknown, expired or the wrong purpose.
 */
export function consumeChallenge(
  db: Db | Tx,
  token: string,
  purpose: ChallengePurpose,
  now: Date,
): ConsumedChallenge | null {
  if (!TOKEN_SHAPE.test(token)) return null
  const row = db
    .delete(passkeyChallenges)
    .where(eq(passkeyChallenges.tokenHash, hashToken(token)))
    .returning()
    .get()
  if (row?.purpose !== purpose || row.expiresAt <= toIsoUtc(now)) return null
  return { challenge: row.challenge, userId: row.userId, userHandle: row.userHandle }
}
