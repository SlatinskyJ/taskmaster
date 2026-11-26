import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withAudit } from '~/server/audit'
import type { CurrentUser } from '~/server/auth'
import type { Db } from '~/server/db'
import { featureFlags } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import {
  liveSubscription,
  liveSubscriptionIn,
  readSubscription,
  signSubscription,
} from './subscription'
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
const many = (n: number): Topic[] =>
  Array.from({ length: n }, (_, i) => `task:${String(i + 1)}` as Topic)

afterEach(() => {
  req.token = undefined
})

/** Edits a token's payload (keeping its signature). */
function editPayload(token: string, edit: (p: { u: number; t: string[]; a: number }) => void) {
  const [payload = '', sig = ''] = token.split('.')
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    u: number
    t: string[]
    a: number
  }
  edit(data)
  return `${Buffer.from(JSON.stringify(data)).toString('base64url')}.${sig}`
}

describe('signSubscription / readSubscription', () => {
  it('round trip returns the same user, topics and asOf', () => {
    const token = signSubscription(A, 3, ['week', 'points:3'], 41)
    expect(readSubscription(A, token)).toEqual({
      userId: 3,
      topics: ['week', 'points:3'],
      asOf: 41,
    })
  })

  it("a token signed with session A's key is null under session B's key", () => {
    expect(readSubscription(B, signSubscription(A, 3, ['week'], 1))).toBeNull()
  })

  it('an edited payload (one more topic) is null', () => {
    const token = editPayload(signSubscription(A, 3, ['week'], 1), (p) => p.t.push('disputes'))
    expect(readSubscription(A, token)).toBeNull()
  })

  it('an edited user or asOf is null', () => {
    const token = signSubscription(A, 3, ['week'], 10)
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
    const payload = Buffer.from(JSON.stringify({ u: 3, t: ['period:1'], a: 1 })).toString(
      'base64url',
    )
    const good = signSubscription(A, 3, ['week'], 1)
    const sig = createHmac('sha256', A).update(payload).digest('base64url')
    expect(readSubscription(A, `${payload}.${sig}`)).toBeNull()
    expect(readSubscription(A, good)).not.toBeNull()
    expect(() => signSubscription(A, 3, ['period:1' as Topic], 1)).toThrow('not a topic')
  })

  it('garbage is null', () => {
    for (const t of ['', '.', 'a.b', 'a.b.c', `${signSubscription(A, 3, ['week'], 1)}x`]) {
      expect(readSubscription(A, t), t).toBeNull()
    }
  })

  it('exactly TOPIC_LIMIT (20) topics signs; 21 topics: signSubscription throws', () => {
    expect(TOPIC_LIMIT).toBe(20)
    expect(readSubscription(A, signSubscription(A, 3, many(20), 1))?.topics).toHaveLength(20)
    expect(() => signSubscription(A, 3, many(21), 1)).toThrow('21 topics')
  })
})

describe('liveSubscription', () => {
  function db(on: boolean): Db {
    const d = createTestDb()
    d.update(featureFlags).set({ enabled: on }).where(eq(featureFlags.key, 'liveChanges')).run()
    return d
  }

  it('switch off → null', () => {
    req.db = db(false)
    req.token = A
    expect(liveSubscription(starsi, ['week'])).toBeNull()
  })

  it('no session token → null', () => {
    req.db = db(true)
    expect(liveSubscription(starsi, ['week'])).toBeNull()
  })

  it('on → token for the user, asOf = max(audit_log.id)', () => {
    req.db = db(true)
    req.token = A
    expect(liveSubscription(starsi, ['week'])?.asOf).toBe(0)
    withAudit(req.db, () => undefined, [
      {
        actor: { kind: 'system' },
        action: 'period.created',
        entityType: 'period',
        entityId: 1,
      },
      { actor: { kind: 'system' }, action: 'period.ended', entityType: 'period', entityId: 1 },
    ])
    const sub = liveSubscription(starsi, ['week', 'points:3'])
    expect(sub?.asOf).toBe(2)
    expect(readSubscription(A, sub?.token ?? '')).toEqual({
      userId: 3,
      topics: ['week', 'points:3'],
      asOf: 2,
    })
    expect(liveSubscriptionIn(req.db, B, starsi, ['week'])?.token).not.toBe(sub?.token)
  })
})
