import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import type { Db } from '~/server/db'
import { tasks } from '~/server/db/schema'
import { listPeriods, rollPeriods } from '~/server/periods'
import { completeTask, rejectTask } from '~/server/tasks/lifecycle'
import { family, must } from '~/server/tasks/testing'
import { getMeeting, settlePeriod } from './meeting'
import { CUTOFF, doneTask, MEETING, plus, prague, reservedTask, SAT, week } from './testing'
import { getWeek } from './week'

const D = DEFAULT_PERIOD_DEFAULTS
const H = 3_600_000
const MONDAY = prague(2026, 11, 30, 10)

type F = ReturnType<typeof week>

const giver = (f: F) => ({ id: f.tata, role: 'giver' as const })
const starsi = (f: F) => ({ id: f.starsi, role: 'taker' as const })

/** Táta confirms the meeting at `now` with the totals it shows. */
function settle(db: Db, tata: number, now: Date) {
  const m = getMeeting(db, now)
  if (!m.period) throw new Error('nothing to settle')
  must(
    settlePeriod(
      db,
      tata,
      m.period.id,
      m.takers.map((t) => ({ takerId: t.id, total: t.total })),
      now,
      D,
    ),
  )
}

/** Starší 112 confirmed + 2 waiting, Mladší 47, all in P1. */
function demoWeek() {
  const f = week()
  doneTask(f, { score: 40, completedAt: plus(SAT, H), earner: f.starsi })
  doneTask(f, { score: 50, completedAt: plus(SAT, 2 * H), earner: f.starsi })
  doneTask(f, { score: 22, completedAt: plus(SAT, 3 * H), earner: f.starsi })
  doneTask(f, { score: 47, completedAt: plus(SAT, H), earner: f.mladsi })
  doneTask(f, {
    score: 2,
    completedAt: plus(SAT, 4 * H),
    earner: f.starsi,
    status: 'done_unconfirmed',
  })
  return f
}

/** Approves every waiting item, as the meeting's step 1 would. */
const approveAll = (f: F) =>
  f.db.update(tasks).set({ status: 'confirmed' }).where(eq(tasks.status, 'done_unconfirmed')).run()

/** A reserved task Starší does at `at` and Táta rejects at `at` + 1 min. */
function rejected(f: F, score: number, at: Date, reason?: string) {
  const id = reservedTask(f, f.starsi, score)
  must(completeTask(f.db, f.starsi, id, at))
  must(rejectTask(f.db, f.tata, id, reason, plus(at, 60_000)))
  return id
}

describe('getWeek', () => {
  it('no period yet: period null, takers listed with 0s, history empty', () => {
    const f = family()
    expect(getWeek(f.db, { id: f.tata, role: 'giver' }, SAT)).toEqual({
      period: null,
      takers: [
        {
          id: f.starsi,
          name: 'Starší',
          confirmed: 0,
          pending: 0,
          carriedIn: 0,
          unsettled: 0,
          items: [],
        },
        {
          id: f.mladsi,
          name: 'Mladší',
          confirmed: 0,
          pending: 0,
          carriedIn: 0,
          unsettled: 0,
          items: [],
        },
      ],
      history: [],
    })
  })

  it('running week, pinned whole for Starší: only his own data', () => {
    const f = demoWeek()
    expect(getWeek(f.db, starsi(f), MEETING)).toEqual({
      period: {
        id: f.p1.id,
        startsAt: SAT.toISOString(),
        cutoffAt: CUTOFF.toISOString(),
        levels: { lower: 50, upper: 100 },
      },
      takers: [
        {
          id: f.starsi,
          name: 'Starší',
          confirmed: 112,
          pending: 2,
          carriedIn: 0,
          unsettled: 0,
          items: [4, 3, 2, 1].map((h, i) => ({
            taskId: expect.any(Number) as number,
            title: 'Vyndat myčku',
            score: [2, 22, 50, 40][i],
            status: i === 0 ? 'done_unconfirmed' : 'confirmed',
            at: plus(SAT, h * H).toISOString(),
            reason: null,
          })),
        },
      ],
      history: [],
    })
  })

  it('a giver sees every active taker; a taker only himself; any other role nobody else', () => {
    const f = demoWeek()
    approveAll(f)
    settle(f.db, f.tata, MEETING)
    const ids = (viewer: { id: number; role: 'giver' | 'taker' | 'admin' }) => {
      const w = getWeek(f.db, viewer, MONDAY)
      return [w.takers.map((t) => t.id), w.history.flatMap((h) => h.records.map((r) => r.takerId))]
    }
    expect(ids(giver(f))).toEqual([
      [f.starsi, f.mladsi],
      [f.starsi, f.mladsi],
    ])
    expect(ids(starsi(f))).toEqual([[f.starsi], [f.starsi]])
    expect(ids({ id: f.mladsi, role: 'taker' })).toEqual([[f.mladsi], [f.mladsi]])
    expect(ids({ id: f.admin, role: 'admin' })).toEqual([[], []])
  })

  it('after a settlement: history matches the records, endsAt = endedAt, items reset', () => {
    const f = demoWeek()
    approveAll(f)
    settle(f.db, f.tata, MEETING)
    const w = getWeek(f.db, giver(f), MONDAY)
    expect(w.period?.startsAt).toBe(MEETING.toISOString())
    expect(w.history).toEqual([
      {
        periodId: f.p1.id,
        startsAt: SAT.toISOString(),
        endsAt: MEETING.toISOString(),
        levels: { lower: 50, upper: 100 },
        records: [
          {
            takerId: f.starsi,
            name: 'Starší',
            totalBefore: 114,
            level: 'upper',
            deducted: 100,
            carryOver: 14,
          },
          {
            takerId: f.mladsi,
            name: 'Mladší',
            totalBefore: 47,
            level: 'none',
            deducted: 0,
            carryOver: 47,
          },
        ],
      },
    ])
    expect(w.takers.map((t) => [t.confirmed, t.carriedIn, t.items])).toEqual([
      [14, 14, []],
      [47, 47, []],
    ])
  })

  it('history newest first; carriedIn is the latest carry-over; endsAt = cutoff when settled late', () => {
    const f = week()
    doneTask(f, { score: 130, completedAt: plus(SAT, H), earner: f.starsi })
    doneTask(f, { score: 10, completedAt: plus(SAT, H), earner: f.mladsi })
    settle(f.db, f.tata, MEETING) // P1: Starší 130 → carry 30
    const p2 = listPeriods(f.db)[1]
    if (!p2) throw new Error('no P2')
    doneTask(f, { score: 28, completedAt: plus(MEETING, H), earner: f.starsi })
    const late = plus(p2.cutoffAt, 10 * H)
    rollPeriods(f.db, late, D)
    settle(f.db, f.tata, late) // P2 after its cutoff: 30 + 28 = 58 → lower, carry 8
    const w = getWeek(f.db, starsi(f), late)
    expect(w.history.map((h) => [h.periodId, h.endsAt, h.records[0]?.carryOver])).toEqual([
      [p2.id, p2.cutoffAt.toISOString(), 8],
      [f.p1.id, MEETING.toISOString(), 30],
    ])
    expect(w.takers[0]?.carriedIn).toBe(8)
  })

  it('late meeting: last week apart until settled (Jakub 2026-11-21); its waiting item still listed', () => {
    const f = week()
    doneTask(f, { score: 30, completedAt: plus(SAT, H), earner: f.starsi })
    const waiting = doneTask(f, {
      score: 6,
      completedAt: plus(SAT, 2 * H),
      earner: f.starsi,
      status: 'done_unconfirmed',
    })
    rollPeriods(f.db, MONDAY, D) // P1 ended at its cutoff, not settled
    const now5 = doneTask(f, { score: 5, completedAt: plus(MONDAY, -H), earner: f.starsi })
    const now2 = doneTask(f, {
      score: 2,
      completedAt: plus(MONDAY, -H / 2),
      earner: f.starsi,
      status: 'done_unconfirmed',
    })
    const [t] = getWeek(f.db, starsi(f), MONDAY).takers
    expect([t?.confirmed, t?.pending, t?.unsettled]).toEqual([5, 2, 36])
    expect(t?.items.map((i) => i.taskId)).toEqual([now2, now5, waiting])
  })

  it('late meeting settled: nothing apart any more, bar = carry-over + this week', () => {
    const f = week()
    doneTask(f, { score: 130, completedAt: plus(SAT, H), earner: f.starsi })
    rollPeriods(f.db, MONDAY, D) // P1 ended at its cutoff, not settled
    doneTask(f, { score: 5, completedAt: plus(MONDAY, -H), earner: f.starsi })
    expect(getWeek(f.db, starsi(f), MONDAY).takers[0]?.unsettled).toBe(130)
    settle(f.db, f.tata, MONDAY) // P1: 130 → upper, carry 30
    const [t] = getWeek(f.db, starsi(f), MONDAY).takers
    expect([t?.confirmed, t?.carriedIn, t?.unsettled]).toEqual([35, 30, 0])
  })

  it('a completion exactly at the start is this week; one a millisecond before is not', () => {
    const f = week()
    const before = doneTask(f, { score: 3, completedAt: plus(SAT, -1), earner: f.starsi })
    const at = doneTask(f, { score: 4, completedAt: SAT, earner: f.starsi })
    const items = getWeek(f.db, starsi(f), MEETING).takers[0]?.items ?? []
    expect(items.map((i) => i.taskId)).toEqual([at])
    expect(before).toBeGreaterThan(0)
  })

  it("a giver's completion (no earner) is in nobody's items", () => {
    const f = week()
    doneTask(f, { score: 9, completedAt: plus(SAT, H), earner: null })
    expect(getWeek(f.db, giver(f), MEETING).takers.flatMap((t) => t.items)).toEqual([])
  })

  it("rejections: this period's, with score and reason; at the start counts; not before; not another taker's", () => {
    const f = week()
    const old = rejected(f, 9, plus(SAT, -61_000)) // rejected 1 s before the start
    const edge = rejected(f, 4, plus(SAT, -60_000)) // rejected exactly at the start
    const r = rejected(f, 7, plus(SAT, H), 'nádobí zůstalo v dřezu')
    const items = getWeek(f.db, giver(f), MEETING).takers
    expect(items[0]?.items).toEqual([
      {
        taskId: r,
        title: 'Vynést koš',
        score: 7,
        status: 'rejected',
        at: plus(SAT, H + 60_000).toISOString(),
        reason: 'nádobí zůstalo v dřezu',
      },
      {
        taskId: edge,
        title: 'Vynést koš',
        score: 4,
        status: 'rejected',
        at: SAT.toISOString(),
        reason: null,
      },
    ])
    expect(items[1]?.items).toEqual([])
    expect(old).toBeGreaterThan(0)
  })

  it('between a cutoff and the roll: period null, points still from the ledger, no items', () => {
    const f = demoWeek()
    const w = getWeek(f.db, starsi(f), plus(CUTOFF, 30_000))
    expect(w.period).toBeNull()
    expect(w.takers).toEqual([
      {
        id: f.starsi,
        name: 'Starší',
        confirmed: 112,
        pending: 2,
        carriedIn: 0,
        unsettled: 0,
        items: [],
      },
    ])
  })
})
