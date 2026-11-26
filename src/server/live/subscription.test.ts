import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withAudit } from '~/server/audit'
import type { CurrentUser } from '~/server/auth'
import type { Db } from '~/server/db'
import { featureFlags } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { liveSubscriptionIn, readSubscription, signSubscription } from './subscription'
import { TOPIC_LIMIT } from './topics'
import type { Topic } from './topics'

// Signed subscriptions (#299): only the server can issue a stream's topics, per login.

const req = vi.hoisted(() => ({
  db: null as unknown as Db,
  token: undefined as string | undefined,
}))
vi.mock('~/server/db', () => ({ getDb: () => req.db }))
vi.mock('~/server/auth/http', () => ({ sessionToken: () => req.token }))

const A = 'session-token-a'
const B = 'session-token-b'
const starsi: CurrentUser = { id: 3, username: 'starsi', displayName: 'Starší', role: 'taker' }
const T3 = { id: 3, role: 'taker' } as const
const many = (n: number): Topic[] =>
  Array.from({ length: n }, (_, i) => `task:${String(i + 1)}` as Topic)

afterEach(() => {
  req.token = undefined
})

/** Edits a token's payload (keeping its signature). */
interface Payload {
  u: number
  r?: string
  t: string[]
  a: number
}

function decode(token: string): Payload {
  const [payload = ''] = token.split('.')
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Payload
}

function editPayload(token: string, edit: (p: Payload) => void) {
  const [, sig = ''] = token.split('.')
  const data = decode(token)
  edit(data)
  return `${Buffer.from(JSON.stringify(data)).toString('base64url')}.${sig}`
}

/** Edits a token's payload and signs it again with the right key: only the edit is wrong. */
function resign(key: string, token: string, edit: (p: Payload) => void) {
  const data = decode(token)
  edit(data)
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
}

describe('signSubscription / readSubscription', () => {
  it('round trip returns the same user, topics and asOf', () => {
    const token = signSubscription(A, T3, ['week', 'points:3'], 41)
    expect(readSubscription(A, token)).toEqual({
      userId: 3,
      role: 'taker',
      topics: ['week', 'points:3'],
      asOf: 41,
    })
  })

  it("a token signed with session A's key is null under session B's key", () => {
    expect(readSubscription(B, signSubscription(A, T3, ['week'], 1))).toBeNull()
  })

  it('an edited payload (one more topic) is null', () => {
    const token = editPayload(signSubscription(A, T3, ['week'], 1), (p) => p.t.push('disputes'))
    expect(readSubscription(A, token)).toBeNull()
  })

  it('an edited user or asOf is null', () => {
    const token = signSubscription(A, T3, ['week'], 10)
    expect(
      readSubscription(
        A,
        editPayload(token, (p) => (p.u = 4)),
      ),
    ).toBeNull()
    expect(
      readSubscription(
        A,
        editPayload(token, (p) => (p.a = 0)),
      ),
    ).toBeNull()
  })

  it('a token with an unknown topic string is null', () => {
    // Signed by hand: signSubscription itself refuses one.
    const payload = Buffer.from(
      JSON.stringify({ u: 3, r: 'taker', t: ['period:1'], a: 1 }),
    ).toString('base64url')
    const good = signSubscription(A, T3, ['week'], 1)
    const sig = createHmac('sha256', A).update(payload).digest('base64url')
    expect(readSubscription(A, `${payload}.${sig}`)).toBeNull()
    expect(readSubscription(A, good)).not.toBeNull()
    expect(() => signSubscription(A, T3, ['period:1' as Topic], 1)).toThrow('not a topic')
  })

  it('garbage is null', () => {
    for (const t of ['', '.', 'a.b', 'a.b.c', `${signSubscription(A, T3, ['week'], 1)}x`]) {
      expect(readSubscription(A, t), t).toBeNull()
    }
  })

  it('exactly TOPIC_LIMIT (50) topics signs; 51 topics: signSubscription throws', () => {
    expect(TOPIC_LIMIT).toBe(50)
    expect(readSubscription(A, signSubscription(A, T3, many(50), 1))?.topics).toHaveLength(50)
    expect(() => signSubscription(A, T3, many(51), 1)).toThrow('51 topics')
  })

  it('signs the role: payload keys are exactly u, r, t, a', () => {
    const p = decode(signSubscription(A, T3, ['week'], 1))
    expect(Object.keys(p)).toEqual(['u', 'r', 't', 'a'])
    expect(p.r).toBe('taker')
  })

  it('a payload without a role or with an unknown role reads as null', () => {
    const token = signSubscription(A, T3, ['week'], 1)
    expect(
      readSubscription(
        A,
        resign(A, token, () => undefined),
      ),
    ).not.toBeNull()
    expect(
      readSubscription(
        A,
        resign(A, token, (p) => delete p.r),
      ),
    ).toBeNull()
    expect(
      readSubscription(
        A,
        resign(A, token, (p) => (p.r = 'king')),
      ),
    ).toBeNull()
    expect(
      readSubscription(
        A,
        resign(A, token, (p) => (p.r = 'giver')),
      )?.role,
    ).toBe('giver')
  })
})

describe('liveSubscriptionIn', () => {
  function db(on: boolean): Db {
    const d = createTestDb()
    d.update(featureFlags).set({ enabled: on }).where(eq(featureFlags.key, 'liveChanges')).run()
    return d
  }

  it('switch off → null', () => {
    req.db = db(false)
    req.token = A
    expect(liveSubscriptionIn(req.db, req.token, starsi, ['week'], {})).toBeNull()
  })

  it('no session token → null', () => {
    req.db = db(true)
    expect(liveSubscriptionIn(req.db, req.token, starsi, ['week'], {})).toBeNull()
  })

  it('on → token for the user, asOf = max(audit_log.id)', () => {
    req.db = db(true)
    req.token = A
    expect(liveSubscriptionIn(req.db, req.token, starsi, ['week'], {})?.asOf).toBe(0)
    withAudit(req.db, () => undefined, [
      {
        actor: { kind: 'system' },
        action: 'period.created',
        entityType: 'period',
        entityId: 1,
      },
      { actor: { kind: 'system' }, action: 'period.ended', entityType: 'period', entityId: 1 },
    ])
    const sub = liveSubscriptionIn(req.db, req.token, starsi, ['week', 'points:3'], {})
    expect(sub?.asOf).toBe(2)
    expect(readSubscription(A, sub?.token ?? '')).toEqual({
      userId: 3,
      role: 'taker',
      topics: ['week', 'points:3'],
      asOf: 2,
    })
    expect(liveSubscriptionIn(req.db, B, starsi, ['week'], {})?.token).not.toBe(sub?.token)
  })
})
