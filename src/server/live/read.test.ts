import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { writeAudit } from '~/server/audit'
import type { CurrentUser } from '~/server/auth'
import type { Db } from '~/server/db'
import { featureFlags } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { liveRead, serveLive, serveLiveIn } from './read'
import type { LiveRead } from './read'
import { readSubscription } from './subscription'
import type { Topic } from './topics'

// serveLive (#299): the data and the subscription for what it read, in one synchronous block.

const req = vi.hoisted(() => ({
  db: null as unknown as Db,
  token: undefined as string | undefined,
}))
vi.mock('~/server/db', () => ({ getDb: () => req.db }))
vi.mock('~/server/auth/http', () => ({ sessionToken: () => req.token }))

const KEY = 'session-key-for-read-tests'
const NOW = new Date('2026-11-26T10:00:00Z')
const starsi: CurrentUser = { id: 3, username: 'starsi', displayName: 'Starší', role: 'taker' }

function db(on = true): Db {
  const d = createTestDb()
  d.update(featureFlags).set({ enabled: on }).where(eq(featureFlags.key, 'liveChanges')).run()
  return d
}

function audit(d: Db) {
  d.transaction((tx) => {
    writeAudit(tx, {
      actor: { kind: 'system' },
      action: 'period.created',
      entityType: 'period',
      entityId: 1,
      at: NOW,
    })
  })
}

const many = (n: number): Topic[] =>
  Array.from({ length: n }, (_, i) => `task:${String(i + 1)}` as Topic)

const def = (topics: readonly Topic[]): LiveRead<{ n: number }, { n: number; who: number }> =>
  liveRead({
    read: (_db, viewer, arg) => ({ n: arg.n, who: viewer.id }),
    topics: () => topics,
  })

describe('serveLiveIn', () => {
  it('returns the data and a token for the topics, asOf the newest audit id before the read', () => {
    const d = db()
    audit(d)
    audit(d)
    const out = serveLiveIn(d, KEY, def(['week', 'points:3']), starsi, { n: 7 }, NOW)
    expect(out.data).toEqual({ n: 7, who: 3 })
    expect(out.live?.asOf).toBe(2)
    expect(readSubscription(KEY, out.live?.token ?? '')).toEqual({
      userId: 3,
      role: 'taker',
      topics: ['points:3', 'week'],
      asOf: 2,
    })
  })

  it('a change written by a later request is after asOf, so the stream replays it', () => {
    const d = db()
    audit(d)
    const out = serveLiveIn(d, KEY, def(['week']), starsi, { n: 1 }, NOW)
    audit(d)
    const sub = readSubscription(KEY, out.live?.token ?? '')
    expect(sub?.asOf).toBe(1)
    expect(sub?.asOf ?? Infinity).toBeLessThan(2)
  })

  it('topics see the data the read returned', () => {
    const d = db()
    const seen: unknown[] = []
    const out = serveLiveIn(
      d,
      KEY,
      liveRead({
        read: () => [5, 6],
        topics: (_v, data) => {
          seen.push(data)
          return data.map((id) => `task:${String(id)}` as Topic)
        },
      }),
      starsi,
      undefined,
      NOW,
    )
    expect(seen).toEqual([[5, 6]])
    expect(readSubscription(KEY, out.live?.token ?? '')?.topics).toEqual(['task:5', 'task:6'])
  })

  it('no topics: live is null, data still returned', () => {
    expect(serveLiveIn(db(), KEY, def([]), starsi, { n: 2 }, NOW)).toEqual({
      data: { n: 2, who: 3 },
      live: null,
    })
  })

  it('switch off: live is null', () => {
    expect(serveLiveIn(db(false), KEY, def(['week']), starsi, { n: 2 }, NOW).live).toBeNull()
  })

  it('no session key: live is null', () => {
    expect(serveLiveIn(db(), undefined, def(['week']), starsi, { n: 2 }, NOW).live).toBeNull()
  })

  it('duplicate topics are signed once, sorted', () => {
    const out = serveLiveIn(
      db(),
      KEY,
      def(['week', 'tasks', 'week', 'people']),
      starsi,
      { n: 1 },
      NOW,
    )
    expect(readSubscription(KEY, out.live?.token ?? '')?.topics).toEqual([
      'people',
      'tasks',
      'week',
    ])
  })

  it('pins the shape: exactly { data, live: { token, asOf } }', () => {
    const out = serveLiveIn(db(), KEY, def(['week']), starsi, { n: 1 }, NOW)
    expect(Object.keys(out)).toEqual(['data', 'live'])
    expect(Object.keys(out.live ?? {})).toEqual(['token', 'asOf'])
  })

  it('51 topics: throws in test; in production logs and returns live null', () => {
    const d = db()
    expect(() => serveLiveIn(d, KEY, def(many(51)), starsi, { n: 1 }, NOW, {})).toThrow('51 topics')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const out = serveLiveIn(d, KEY, def(many(51)), starsi, { n: 1 }, NOW, {
        NODE_ENV: 'production',
      })
      expect(out).toEqual({ data: { n: 1, who: 3 }, live: null })
      expect(spy).toHaveBeenCalledTimes(1)
      const line = spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
      expect(line).toMatch(/subscription refused: 51 topics, limit 50/)
      expect(line).not.toContain(KEY)
      expect(line).not.toContain('task:')
    } finally {
      spy.mockRestore()
    }
  })

  it('50 topics: signed', () => {
    const out = serveLiveIn(db(), KEY, def(many(50)), starsi, { n: 1 }, NOW, {
      NODE_ENV: 'production',
    })
    expect(readSubscription(KEY, out.live?.token ?? '')?.topics).toHaveLength(50)
  })

  it('an invalid topic throws in production too', () => {
    expect(() =>
      serveLiveIn(db(), KEY, def(['period:1' as Topic]), starsi, { n: 1 }, NOW, {
        NODE_ENV: 'production',
      }),
    ).toThrow('not a topic')
  })
})

describe('serveLive', () => {
  it("reads the request's DB and session key", () => {
    req.db = db()
    req.token = KEY
    const out = serveLive(def(['week']), starsi, { n: 4 })
    expect(out.data).toEqual({ n: 4, who: 3 })
    expect(readSubscription(KEY, out.live?.token ?? '')?.topics).toEqual(['week'])
    req.token = undefined
    expect(serveLive(def(['week']), starsi, { n: 4 }).live).toBeNull()
  })

  it('serveLive passes a Date as now', () => {
    req.db = db()
    req.token = KEY
    const seen = liveRead({
      read: (_db, _viewer, _arg: undefined, now) => {
        expect(now).toBeInstanceOf(Date)
        return now
      },
      topics: () => ['week'] as const,
    })
    expect(serveLive(seen, starsi, undefined).data).toBeInstanceOf(Date)
  })
})
