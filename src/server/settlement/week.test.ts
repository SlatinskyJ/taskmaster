import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import type { Db } from '~/server/db'
import { settlements, tasks } from '~/server/db/schema'
import { listPeriods, rollPeriods } from '~/server/periods'
import { correctSettlementIn } from '~/server/corrections'
import { openDisputeIn } from '~/server/disputes'
import { approveTask, completeTask, rejectTask } from '~/server/tasks/lifecycle'
import { rejectionsSince } from '~/server/tasks/rejections'
import { family, must } from '~/server/tasks/testing'
import { getMeeting, settlePeriod } from './meeting'
import {
  adjustment,
  CUTOFF,
  doneTask,
  MEETING,
  plus,
  prague,
  reservedTask,
  SAT,
  week,
} from './testing'
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
          adjustments: [],
        },
        {
          id: f.mladsi,
          name: 'Mladší',
          confirmed: 0,
          pending: 0,
          carriedIn: 0,
          unsettled: 0,
          items: [],
          adjustments: [],
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
            // A confirmed item can be disputed (#46); a waiting one is not locked yet.
            ...(i === 0
              ? {}
              : {
                  dispute: {
                    item: { kind: 'completion', id: expect.any(Number) as number },
                    mark: null,
                  },
                }),
          })),
          adjustments: [],
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
            id: expect.any(Number) as number,
            takerId: f.starsi,
            name: 'Starší',
            totalBefore: 114,
            level: 'upper',
            deducted: 100,
            carryOver: 14,
            dispute: null,
            correction: null,
            adjustments: [],
          },
          {
            id: expect.any(Number) as number,
            takerId: f.mladsi,
            name: 'Mladší',
            totalBefore: 47,
            level: 'none',
            deducted: 0,
            carryOver: 47,
            dispute: null,
            correction: null,
            adjustments: [],
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
    const entry = (task: number) => ({
      item: {
        kind: 'rejection',
        id: rejectionsSince(f.db, new Date(0)).find((x) => x.taskId === task)?.entryId,
      },
      mark: null,
    })
    expect(items[0]?.items).toEqual([
      {
        taskId: r,
        title: 'Vynést koš',
        score: 7,
        status: 'rejected',
        at: plus(SAT, H + 60_000).toISOString(),
        reason: 'nádobí zůstalo v dřezu',
        closed: false,
        dispute: entry(r),
      },
      {
        taskId: edge,
        title: 'Vynést koš',
        score: 4,
        status: 'rejected',
        at: SAT.toISOString(),
        reason: null,
        closed: false,
        dispute: entry(edge),
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
        adjustments: [],
      },
    ])
  })
})

describe('getWeek dispute marks (#46)', () => {
  const at = plus(MEETING, H)

  it('a confirmed item is keyed by its task; after a dispute its mark is open', () => {
    const f = demoWeek()
    const item = getWeek(f.db, starsi(f), MEETING).takers[0]?.items.find(
      (i) => i.status === 'confirmed',
    )
    expect(item?.dispute).toEqual({ item: { kind: 'completion', id: item?.taskId }, mark: null })
    must(openDisputeIn(f.db, f.starsi, { kind: 'completion', id: item?.taskId ?? 0 }, 'x', at))
    const again = getWeek(f.db, starsi(f), at).takers[0]?.items.find(
      (i) => i.taskId === item?.taskId,
    )
    expect(again?.dispute?.mark).toEqual({ status: 'open' })
  })

  it('a rejected row is keyed by its entry: its mark and the confirmed row of the same task stay apart', () => {
    const f = week()
    const id = rejected(f, 4, plus(SAT, H), 'Znovu.')
    must(completeTask(f.db, f.starsi, id, plus(SAT, 2 * H)))
    must(approveTask(f.db, f.tata, id, plus(SAT, 2 * H)))
    const items = () => getWeek(f.db, starsi(f), at).takers[0]?.items ?? []
    const rejectedRow = () => items().find((i) => i.status === 'rejected')
    const confirmedRow = () => items().find((i) => i.status === 'confirmed')
    const entryId = rejectionsSince(f.db, SAT)[0]?.entryId
    expect(rejectedRow()?.dispute?.item).toEqual({ kind: 'rejection', id: entryId })
    must(openDisputeIn(f.db, f.starsi, { kind: 'rejection', id: entryId ?? 0 }, 'x', at))
    expect(rejectedRow()?.dispute?.mark).toEqual({ status: 'open' })
    expect(confirmedRow()?.dispute).toEqual({ item: { kind: 'completion', id }, mark: null })
  })

  it('a confirmed row disputed leaves the rejected row of the same task unmarked', () => {
    const f = week()
    const id = rejected(f, 4, plus(SAT, H))
    must(completeTask(f.db, f.starsi, id, plus(SAT, 2 * H)))
    must(approveTask(f.db, f.tata, id, plus(SAT, 2 * H)))
    must(openDisputeIn(f.db, f.starsi, { kind: 'completion', id }, 'x', at))
    const items = getWeek(f.db, starsi(f), at).takers[0]?.items ?? []
    expect(items.find((i) => i.status === 'rejected')?.dispute?.mark).toBeNull()
    expect(items.find((i) => i.status === 'confirmed')?.dispute?.mark).toEqual({ status: 'open' })
  })

  it('a history record carries its settlement id; a dispute on it marks only that record', () => {
    const f = demoWeek()
    approveAll(f)
    settle(f.db, f.tata, MEETING)
    const records = () => getWeek(f.db, giver(f), MONDAY).history[0]?.records ?? []
    const [first, second] = records()
    const ids = f.db.select().from(settlements).all()
    expect(first?.id).toBe(ids.find((r) => r.takerId === f.starsi)?.id)
    must(openDisputeIn(f.db, f.starsi, { kind: 'settlement', id: first?.id ?? 0 }, 'x', MONDAY))
    expect(records().map((r) => r.dispute)).toEqual([{ status: 'open' }, null])
    expect(second?.takerId).toBe(f.mladsi)
  })
})

describe('getWeek adjustments (#48)', () => {
  it('an adjustment made this week is in confirmed, not waiting for the meeting', () => {
    const f = week()
    doneTask(f, { score: 10, completedAt: plus(SAT, H), earner: f.starsi })
    adjustment(f, f.starsi, 5, plus(SAT, 2 * H))
    const [t] = getWeek(f.db, starsi(f), MEETING).takers
    expect([t?.confirmed, t?.unsettled]).toEqual([15, 0])
  })

  it('an adjustment of a settled week is in the carry-over only, not counted again', () => {
    const f = week()
    doneTask(f, { score: 60, completedAt: plus(SAT, H), earner: f.starsi })
    adjustment(f, f.starsi, 5, plus(SAT, 2 * H))
    rollPeriods(f.db, MONDAY, D)
    settle(f.db, f.tata, MONDAY) // P1: 65 → lower 50, carry 15
    const [t] = getWeek(f.db, starsi(f), MONDAY).takers
    expect([t?.carriedIn, t?.confirmed, t?.unsettled]).toEqual([15, 15, 0])
  })

  it('an adjustment exactly at the week start counts this week; a millisecond before does not', () => {
    const f = week()
    adjustment(f, f.starsi, 4, SAT)
    adjustment(f, f.starsi, 3, plus(SAT, -1))
    const [t] = getWeek(f.db, starsi(f), MEETING).takers
    expect([t?.confirmed, t?.unsettled]).toEqual([4, 3])
  })
})

describe('getWeek adjustment rows and corrections (#48 screens)', () => {
  const at = (d: Date) => d.toISOString()
  const manual = (
    id: number,
    points: number,
    d: Date,
    waiting: boolean,
    reason = 'Pomoc s nákupem.',
  ) => ({
    id,
    points,
    reason,
    at: at(d),
    fromWeek: null,
    waiting,
    dispute: { item: { kind: 'adjustment', id }, mark: null },
  })

  it('an ended, unsettled week: its adjustment is listed this week as waiting; one at the start is not waiting', () => {
    const f = week()
    const before = adjustment(f, f.starsi, 5, plus(CUTOFF, -H))
    rollPeriods(f.db, MONDAY, D) // P2 starts at CUTOFF; P1 waits for its meeting
    const onStart = adjustment(f, f.starsi, 2, CUTOFF)
    const [t] = getWeek(f.db, starsi(f), MONDAY).takers
    expect(t?.adjustments).toEqual([
      manual(before, 5, plus(CUTOFF, -H), true),
      manual(onStart, 2, CUTOFF, false),
    ])
  })

  it('after the meeting: a settled week keeps its own adjustments; one exactly at its end is this week only', () => {
    const f = week()
    doneTask(f, { score: 60, completedAt: plus(SAT, H), earner: f.starsi })
    const inP1 = adjustment(f, f.starsi, 5, plus(SAT, 2 * H))
    rollPeriods(f.db, MONDAY, D)
    const onEnd = adjustment(f, f.starsi, 3, CUTOFF)
    settle(f.db, f.tata, MONDAY)
    const w = getWeek(f.db, starsi(f), MONDAY)
    expect(w.takers[0]?.adjustments).toEqual([manual(onEnd, 3, CUTOFF, false)])
    expect(w.history[0]?.records[0]?.adjustments).toEqual([
      manual(inP1, 5, plus(SAT, 2 * H), false),
    ])
  })

  it("a settled week's record starts exactly at its start: one a millisecond before is not in it", () => {
    const f = week()
    doneTask(f, { score: 60, completedAt: plus(SAT, H), earner: f.starsi })
    adjustment(f, f.starsi, 1, plus(SAT, -1), 'Před týdnem')
    const onStart = adjustment(f, f.starsi, 2, SAT, 'Na začátku')
    rollPeriods(f.db, MONDAY, D)
    settle(f.db, f.tata, MONDAY)
    const w = getWeek(f.db, starsi(f), MONDAY)
    expect(w.history[0]?.startsAt).toBe(at(SAT))
    expect(w.history[0]?.records[0]?.adjustments).toEqual([
      manual(onStart, 2, SAT, false, 'Na začátku'),
    ])
  })

  it('no settlement and no period yet: every adjustment of his is listed, waiting', () => {
    const f = family()
    const id = adjustment(f, f.starsi, 4, SAT)
    const [t] = getWeek(f.db, { id: f.starsi, role: 'taker' }, MEETING).takers
    expect(t?.adjustments).toEqual([manual(id, 4, SAT, true)])
  })

  it("a taker never gets another boy's adjustment rows or reasons; a giver's records hold only their boy's", () => {
    const f = week()
    doneTask(f, { score: 60, completedAt: plus(SAT, H), earner: f.starsi })
    doneTask(f, { score: 60, completedAt: plus(SAT, H), earner: f.mladsi })
    adjustment(f, f.starsi, 1, plus(SAT, 2 * H), 'Starší minulý')
    adjustment(f, f.mladsi, 1, plus(SAT, 2 * H), 'Mladší minulý')
    rollPeriods(f.db, MONDAY, D)
    settle(f.db, f.tata, MONDAY)
    adjustment(f, f.starsi, 1, plus(MONDAY, H), 'Starší teď')
    adjustment(f, f.mladsi, 1, plus(MONDAY, H), 'Mladší teď')
    const mine = getWeek(f.db, starsi(f), plus(MONDAY, 2 * H))
    expect(JSON.stringify(mine)).not.toContain('Mladší')
    expect(mine.takers[0]?.adjustments.map((a) => a.reason)).toEqual(['Starší teď'])
    expect(mine.history[0]?.records[0]?.adjustments.map((a) => a.reason)).toEqual(['Starší minulý'])
    const all = getWeek(f.db, giver(f), plus(MONDAY, 2 * H))
    expect(all.takers.map((t) => t.adjustments.map((a) => a.reason))).toEqual([
      ['Starší teď'],
      ['Mladší teď'],
    ])
    expect(all.history[0]?.records.map((r) => r.adjustments.map((a) => a.reason))).toEqual([
      ['Starší minulý'],
      ['Mladší minulý'],
    ])
  })

  it('a record corrected twice shows the second correction; its adjustments come from that week', () => {
    const f = week()
    doneTask(f, { score: 160, completedAt: plus(SAT, H), earner: f.starsi })
    rollPeriods(f.db, MONDAY, D)
    settle(f.db, f.tata, MONDAY) // upper 100, carry 60
    const s = f.db.select().from(settlements).where(eq(settlements.takerId, f.starsi)).get()
    const first = plus(MONDAY, H)
    const second = plus(MONDAY, 2 * H)
    must(
      correctSettlementIn(
        f.db,
        f.admin,
        { settlementId: s?.id ?? 0, level: 'lower', reason: 'A' },
        null,
        first,
      ),
    )
    must(
      correctSettlementIn(
        f.db,
        f.admin,
        { settlementId: s?.id ?? 0, level: 'none', reason: 'B' },
        null,
        second,
      ),
    )
    const w = getWeek(f.db, starsi(f), plus(MONDAY, 3 * H))
    const record = w.history[0]?.records[0]
    expect(record?.correction).toEqual({ level: 'none', deducted: 0, reason: 'B', at: at(second) })
    expect([record?.level, record?.deducted]).toEqual(['upper', 100])
    const p1 = { startsAt: at(SAT), endsAt: at(CUTOFF) }
    expect(w.takers[0]?.adjustments).toEqual([
      {
        id: expect.any(Number) as number,
        points: 50,
        reason: 'A',
        at: at(first),
        fromWeek: p1,
        waiting: false,
        dispute: null,
      },
      {
        id: expect.any(Number) as number,
        points: 50,
        reason: 'B',
        at: at(second),
        fromWeek: p1,
        waiting: false,
        dispute: null,
      },
    ])
  })

  it('an uncorrected record has correction null; a disputed manual adjustment carries its open mark', () => {
    const f = week()
    doneTask(f, { score: 60, completedAt: plus(SAT, H), earner: f.starsi })
    const id = adjustment(f, f.starsi, 5, plus(SAT, 2 * H))
    must(
      openDisputeIn(f.db, f.starsi, { kind: 'adjustment', id }, 'Bylo to za 10', plus(SAT, 3 * H)),
    )
    const w = getWeek(f.db, starsi(f), plus(SAT, 4 * H))
    expect(w.takers[0]?.adjustments[0]?.dispute?.mark).toEqual(
      expect.objectContaining({ status: 'open' }),
    )
    rollPeriods(f.db, MONDAY, D)
    settle(f.db, f.tata, MONDAY)
    expect(getWeek(f.db, starsi(f), MONDAY).history[0]?.records[0]?.correction).toBeNull()
  })
})
