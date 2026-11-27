import { describe, expect, it } from 'vitest'
import { fail, ok } from '~/domain/result'
import type { SettlementRow } from '~/server/db/schema'
import type { Period } from '~/domain'
import type { Db } from '~/server/db'
import { eq } from 'drizzle-orm'
import { featureFlags } from '~/server/db/schema'
import { family, must } from '~/server/tasks/testing'
import { settled } from './actions'
import { settlePeriod } from './meeting'
import { doneTask, MEETING, plus, SAT, week } from './testing'
import { meetingRead, parseSettle, viewerOf, weekRead } from './functions'

// Input checks and the response shape of the meeting server functions.

function example() {
  const f = week()
  doneTask(f, { score: 100, completedAt: plus(SAT, 3_600_000), earner: f.starsi })
  return f
}
const shownOf = (db: Db, now: Date) => {
  const m = meetingRead.read(
    db,
    { id: 0, username: '', displayName: '', role: 'giver' },
    undefined,
    now,
  )
  return m.period ? m.takers.map((t) => ({ takerId: t.id, total: t.total })) : []
}

const many = (n: number) => Array.from({ length: n }, (_, i) => ({ takerId: i + 1, total: 0 }))

describe('parseSettle', () => {
  it.each([
    [
      { periodId: 1, shown: [{ takerId: 3, total: 130 }] },
      { periodId: 1, shown: [{ takerId: 3, total: 130 }] },
    ],
    [
      { periodId: 1, shown: [] },
      { periodId: 1, shown: [] },
    ],
    [
      { periodId: 1, shown: many(20) },
      { periodId: 1, shown: many(20) },
    ],
  ])('takes %j', (input, out) => {
    expect(parseSettle(input)).toEqual(out)
  })

  it.each([
    {},
    null,
    { periodId: '1', shown: [] },
    { periodId: 1.5, shown: [] },
    { periodId: 1 },
    { periodId: 1, shown: 3 },
    { periodId: 1, shown: many(21) },
    { periodId: 1, shown: [null] },
    { periodId: 1, shown: [{ takerId: 3, total: '5' }] },
    { periodId: 1, shown: [{ takerId: 3.5, total: 5 }] },
  ])('refuses %j', (input) => {
    expect(() => parseSettle(input)).toThrow('Invalid input')
  })

  it('never takes a giver id from the input', () => {
    expect(parseSettle({ periodId: 1, shown: [], giverId: 2 })).toEqual({ periodId: 1, shown: [] })
  })
})

describe('settled (what a confirm returns to the screen)', () => {
  it('only the record fields, the settle time and the next week', () => {
    const row: SettlementRow = {
      id: 9,
      periodId: 1,
      takerId: 3,
      totalBefore: 130,
      level: 'upper',
      deducted: 100,
      carryOver: 30,
      settledBy: 2,
      settledAt: '2026-11-29T19:00:00.000Z',
    }
    const next: Period = {
      id: 2,
      startsAt: new Date('2026-11-29T19:00:00.000Z'),
      cutoffAt: new Date('2026-12-06T22:59:00.000Z'),
      levels: { lower: 50, upper: 100 },
      endedAt: null,
    }
    expect(settled(ok({ records: [row], next }))).toEqual({
      ok: true,
      records: [{ takerId: 3, totalBefore: 130, level: 'upper', deducted: 100, carryOver: 30 }],
      settledAt: '2026-11-29T19:00:00.000Z',
      next: {
        id: 2,
        startsAt: '2026-11-29T19:00:00.000Z',
        cutoffAt: '2026-12-06T22:59:00.000Z',
        levels: { lower: 50, upper: 100 },
      },
    })
    expect(settled(ok({ records: [row], next: null }))).toEqual({
      ok: true,
      records: [{ takerId: 3, totalBefore: 130, level: 'upper', deducted: 100, carryOver: 30 }],
      settledAt: '2026-11-29T19:00:00.000Z',
      next: null,
    })
  })

  it('a success without records is a bug, not a result', () => {
    expect(() => settled(ok({ records: [], next: null }))).toThrow()
  })

  it('a refusal passes through unchanged', () => {
    expect(settled(fail('totals_changed'))).toEqual({ ok: false, error: 'totals_changed' })
  })
})

describe('viewerOf', () => {
  it('keeps only id and role of the signed-in user', () => {
    expect(viewerOf({ id: 3, username: 'starsi', displayName: 'Starší', role: 'taker' })).toEqual({
      id: 3,
      role: 'taker',
    })
  })
})

describe('getMeetingFn (meetingRead) shape (#259)', () => {
  it('returns exactly the old keys plus settledToday, with no settlement rows', () => {
    const f = example()
    const tata = { id: f.tata, username: 'tata', displayName: 'Táta', role: 'giver' as const }
    const read = (now: Date) => meetingRead.read(f.db, tata, undefined, now)
    expect(Object.keys(read(MEETING)).sort()).toEqual([
      'pending',
      'period',
      'settledToday',
      'takers',
    ])
    must(settlePeriod(f.db, f.tata, f.p1.id, shownOf(f.db, MEETING), MEETING, true))
    const after = read(plus(MEETING, 60_000))
    expect(Object.keys(after).sort()).toEqual(['period', 'runningCutoffAt', 'settledToday'])
    expect(after.settledToday).toBe(true)
  })
})

describe('topics (#299)', () => {
  const as = (id: number, role: 'giver' | 'taker') => ({
    id,
    username: role,
    displayName: role,
    role,
  })
  const setDisputes = (f: ReturnType<typeof family>, enabled: boolean) =>
    f.db.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, 'disputes')).run()

  it("a taker's week: week, points and disputes:about of himself only", () => {
    const f = week()
    setDisputes(f, true)
    const starsi = as(f.starsi, 'taker')
    const data = weekRead.read(f.db, starsi, undefined, MEETING)
    const topics = weekRead.topics(starsi, data, f.db)
    expect(topics).toEqual([
      'week',
      `points:${String(f.starsi)}`,
      `disputes:about:${String(f.starsi)}`,
    ])
    for (const t of topics) expect(t.endsWith(`:${String(f.mladsi)}`)).toBe(false)
  })

  it("a giver's week: every boy's points and disputes:about, people", () => {
    const f = week()
    setDisputes(f, true)
    const tata = as(f.tata, 'giver')
    const data = weekRead.read(f.db, tata, undefined, MEETING)
    expect([...weekRead.topics(tata, data, f.db)].sort()).toEqual(
      [
        'week',
        'people',
        `points:${String(f.starsi)}`,
        `points:${String(f.mladsi)}`,
        `disputes:about:${String(f.starsi)}`,
        `disputes:about:${String(f.mladsi)}`,
      ].sort(),
    )
  })

  it('disputes off: no disputes:about on the week', () => {
    const f = week()
    setDisputes(f, false)
    const tata = as(f.tata, 'giver')
    const topics = weekRead.topics(tata, weekRead.read(f.db, tata, undefined, MEETING), f.db)
    expect([...topics].sort()).toEqual(
      ['week', 'people', `points:${String(f.starsi)}`, `points:${String(f.mladsi)}`].sort(),
    )
  })

  it('a taker with an empty takers list still holds only himself', () => {
    const f = week()
    setDisputes(f, true)
    const starsi = as(f.starsi, 'taker')
    const data = weekRead.read(f.db, starsi, undefined, MEETING)
    expect(weekRead.topics(starsi, { ...data, takers: [] }, f.db)).toEqual([
      'week',
      `points:${String(f.starsi)}`,
      `disputes:about:${String(f.starsi)}`,
    ])
  })

  it('meeting without a period: week and people only', () => {
    const f = family()
    const tata = as(f.tata, 'giver')
    const data = meetingRead.read(f.db, tata, undefined, MEETING)
    expect(data.period).toBeNull()
    expect(meetingRead.topics(tata, data, f.db)).toEqual(['week', 'people'])
  })

  it("meeting with a week to settle: week, people and each settled taker's points", () => {
    const f = week()
    const tata = as(f.tata, 'giver')
    const data = meetingRead.read(f.db, tata, undefined, MEETING)
    expect(data.period).not.toBeNull()
    expect(meetingRead.topics(tata, data, f.db)).toEqual([
      'week',
      'people',
      `points:${String(f.starsi)}`,
      `points:${String(f.mladsi)}`,
    ])
  })
})
