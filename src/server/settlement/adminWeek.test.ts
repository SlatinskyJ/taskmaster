import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import type { Db } from '~/server/db'
import { settlements } from '~/server/db/schema'
import { correctSettlementIn } from '~/server/corrections'
import { listPeriods, rollPeriods } from '~/server/periods'
import { must } from '~/server/tasks/testing'
import { getAdminWeek } from './adminWeek'
import { getMeeting, settlePeriod } from './meeting'
import { adjustment, CUTOFF, doneTask, plus, reservedTask, SAT, week } from './testing'

const D = DEFAULT_PERIOD_DEFAULTS
const H = 3_600_000

type F = ReturnType<typeof week>

/** Táta confirms the meeting at `now` with the totals it shows. */
function settle(db: Db, tata: number, now: Date) {
  const m = getMeeting(db, now, false)
  if (!m.period) throw new Error('nothing to settle')
  must(
    settlePeriod(
      db,
      tata,
      m.period.id,
      m.takers.map((t) => ({ takerId: t.id, total: t.total })),
      now,
      false,
    ),
  )
}

/** The latest period ends at its cutoff; the next one starts; Táta settles it 10 h later. */
function settleLatest(f: F): Date {
  const last = listPeriods(f.db).at(-1)
  if (!last) throw new Error('no period')
  const late = plus(last.cutoffAt, 10 * H)
  rollPeriods(f.db, late, D)
  settle(f.db, f.tata, late)
  return late
}

/** The n-th period (1-based). */
function period(f: F, n: number) {
  const p = listPeriods(f.db)[n - 1]
  if (!p) throw new Error(`no P${n}`)
  return p
}

function settlement(f: F, periodId: number, takerId: number) {
  const s = f.db
    .select()
    .from(settlements)
    .where(and(eq(settlements.periodId, periodId), eq(settlements.takerId, takerId)))
    .get()
  if (!s) throw new Error('no settlement')
  return s
}

const view = (f: F, periodId: number, takerId: number) => {
  const w = getAdminWeek(f.db, periodId, takerId)
  if (!w) throw new Error('no week')
  return w
}

/** Starší and Mladší, P1 and P2 settled; each with a completion and an adjustment in P2. */
function twoWeeks() {
  const f = week()
  doneTask(f, { score: 130, completedAt: plus(SAT, H), earner: f.starsi })
  doneTask(f, { score: 60, completedAt: plus(SAT, H), earner: f.mladsi })
  settleLatest(f) // P1: Starší 130 → upper, carry 30; Mladší 60 → lower, carry 10
  const p2 = period(f, 2)
  const s1 = doneTask(f, { score: 28, completedAt: plus(p2.startsAt, H), earner: f.starsi })
  const s2 = doneTask(f, { score: 12, completedAt: plus(p2.startsAt, 3 * H), earner: f.starsi })
  const m1 = doneTask(f, { score: 95, completedAt: plus(p2.startsAt, 2 * H), earner: f.mladsi })
  const sa = adjustment(f, f.starsi, 5, plus(p2.startsAt, 4 * H), 'Starší navíc')
  const ma = adjustment(f, f.mladsi, -3, plus(p2.startsAt, 5 * H), 'Mladší méně')
  settleLatest(f)
  return { f, p1: period(f, 1), p2, s1, s2, m1, sa, ma }
}

describe('getAdminWeek', () => {
  it('settled week: the record, carry-in from his earlier settlement, his tasks and adjustments', () => {
    const { f, p1, p2, s1, s2, sa } = twoWeeks()
    const w = view(f, p2.id, f.starsi)
    const s = settlement(f, p2.id, f.starsi)
    expect(w.taker).toEqual({ id: f.starsi, name: 'Starší' })
    expect(w.week).toEqual({
      periodId: p2.id,
      startsAt: p2.startsAt.toISOString(),
      endsAt: p2.cutoffAt.toISOString(),
      levels: { lower: 50, upper: 100 },
    })
    expect(w.record).toMatchObject({
      id: s.id,
      takerId: f.starsi,
      name: 'Starší',
      totalBefore: s.totalBefore,
      level: s.level,
      deducted: s.deducted,
      carryOver: s.carryOver,
      dispute: null,
      correction: null,
    })
    expect(w.carriedIn).toBe(settlement(f, p1.id, f.starsi).carryOver)
    expect(w.carriedIn).toBe(30)
    expect(w.items).toEqual([
      {
        taskId: s2,
        title: 'Vyndat myčku',
        score: 12,
        status: 'confirmed',
        at: plus(p2.startsAt, 3 * H).toISOString(),
      },
      {
        taskId: s1,
        title: 'Vyndat myčku',
        score: 28,
        status: 'confirmed',
        at: plus(p2.startsAt, H).toISOString(),
      },
    ])
    expect(w.adjustments).toEqual([
      {
        id: sa,
        points: 5,
        reason: 'Starší navíc',
        at: plus(p2.startsAt, 4 * H).toISOString(),
        fromWeek: null,
        waiting: false,
        dispute: { item: { kind: 'adjustment', id: sa }, mark: null },
      },
    ])
    expect(w.record?.adjustments).toEqual(w.adjustments)
  })

  it('boundaries: completed at the start counts, at the end does not', () => {
    const f = week()
    const end = CUTOFF
    const atStart = doneTask(f, { score: 3, completedAt: SAT, earner: f.starsi })
    const atEnd = doneTask(f, { score: 4, completedAt: end, earner: f.starsi })
    const justBefore = doneTask(f, { score: 5, completedAt: plus(end, -1), earner: f.starsi })
    const adjStart = adjustment(f, f.starsi, 1, SAT)
    const adjEnd = adjustment(f, f.starsi, 2, end)
    rollPeriods(f.db, plus(end, H), D) // P1 ends at its cutoff; P2 starts there
    const p1 = view(f, period(f, 1).id, f.starsi)
    expect(p1.week.endsAt).toBe(end.toISOString())
    expect(p1.items.map((i) => i.taskId)).toEqual([justBefore, atStart])
    expect(p1.adjustments.map((a) => a.id)).toEqual([adjStart])
    const p2 = view(f, period(f, 2).id, f.starsi)
    expect(p2.items.map((i) => i.taskId)).toEqual([atEnd])
    expect(p2.adjustments.map((a) => a.id)).toEqual([adjEnd])
  })

  it('only this taker', () => {
    const { f, p1, p2, s1, s2, m1, sa, ma } = twoWeeks()
    const starsi = view(f, p2.id, f.starsi)
    const mladsi = view(f, p2.id, f.mladsi)
    const sS = settlement(f, p2.id, f.starsi)
    const sM = settlement(f, p2.id, f.mladsi)
    // The two records differ, so a mix-up would show.
    expect([sS.totalBefore, sS.level, sS.carryOver]).not.toEqual([
      sM.totalBefore,
      sM.level,
      sM.carryOver,
    ])
    expect(starsi.record).toMatchObject({
      takerId: f.starsi,
      totalBefore: sS.totalBefore,
      level: sS.level,
      carryOver: sS.carryOver,
    })
    expect(starsi.carriedIn).toBe(settlement(f, p1.id, f.starsi).carryOver)
    expect(starsi.items.map((i) => i.taskId)).toEqual([s2, s1])
    expect(starsi.adjustments.map((a) => a.id)).toEqual([sa])
    expect(mladsi.record).toMatchObject({
      takerId: f.mladsi,
      name: 'Mladší',
      totalBefore: sM.totalBefore,
      level: sM.level,
      carryOver: sM.carryOver,
    })
    expect(mladsi.carriedIn).toBe(settlement(f, p1.id, f.mladsi).carryOver)
    expect(mladsi.carriedIn).not.toBe(starsi.carriedIn)
    expect(mladsi.items.map((i) => i.taskId)).toEqual([m1])
    expect(mladsi.adjustments.map((a) => a.id)).toEqual([ma])
  })

  it('carriedIn of an older week', () => {
    const f = week()
    doneTask(f, { score: 130, completedAt: plus(SAT, H), earner: f.starsi })
    settleLatest(f) // P1: carry 30
    doneTask(f, { score: 85, completedAt: plus(period(f, 2).startsAt, H), earner: f.starsi })
    settleLatest(f) // P2: 115 → upper, carry 15
    doneTask(f, { score: 60, completedAt: plus(period(f, 3).startsAt, H), earner: f.starsi })
    settleLatest(f) // P3: 75 → lower, carry 25
    const c = (n: number) => settlement(f, period(f, n).id, f.starsi).carryOver
    expect(new Set([c(1), c(2), c(3)]).size).toBe(3)
    expect(view(f, period(f, 2).id, f.starsi).carriedIn).toBe(c(1))
    expect(view(f, period(f, 3).id, f.starsi).carriedIn).toBe(c(2))
    expect(view(f, period(f, 1).id, f.starsi).carriedIn).toBe(0)
  })

  it('only confirmed and waiting completions', () => {
    const f = week()
    const confirmed = doneTask(f, { score: 3, completedAt: plus(SAT, H), earner: f.starsi })
    const waiting = doneTask(f, {
      score: 4,
      completedAt: plus(SAT, 2 * H),
      earner: f.starsi,
      status: 'done_unconfirmed',
    })
    doneTask(f, { score: 5, completedAt: plus(SAT, 3 * H), earner: f.starsi, status: 'rejected' })
    doneTask(f, { score: 6, completedAt: plus(SAT, 4 * H), earner: f.starsi, status: 'cancelled' })
    reservedTask(f, f.starsi, 7)
    const w = view(f, f.p1.id, f.starsi)
    expect(w.items.map((i) => [i.taskId, i.status])).toEqual([
      [waiting, 'done_unconfirmed'],
      [confirmed, 'confirmed'],
    ])
  })

  it('corrected settlement: the corrected level, and its adjustment in the later week', () => {
    const f = week()
    doneTask(f, { score: 160, completedAt: plus(SAT, H), earner: f.starsi })
    const late = settleLatest(f) // P1: upper 100, carry 60
    const s = settlement(f, f.p1.id, f.starsi)
    const at = plus(late, H) // in P2
    must(
      correctSettlementIn(
        f.db,
        f.admin,
        { settlementId: s.id, level: 'lower', reason: 'Spletli jsme se' },
        null,
        at,
      ),
    )
    const p1 = view(f, f.p1.id, f.starsi)
    expect(p1.record?.correction).toEqual({
      level: 'lower',
      deducted: 50,
      reason: 'Spletli jsme se',
      at: at.toISOString(),
    })
    expect([p1.record?.level, p1.record?.deducted]).toEqual(['upper', 100])
    expect(p1.adjustments).toEqual([])
    const p2 = view(f, period(f, 2).id, f.starsi)
    expect(p2.record).toBeNull()
    expect(p2.adjustments).toEqual([
      {
        id: expect.any(Number) as number,
        points: 50,
        reason: 'Spletli jsme se',
        at: at.toISOString(),
        fromWeek: { startsAt: SAT.toISOString(), endsAt: CUTOFF.toISOString() },
        waiting: false,
        dispute: null,
      },
    ])
  })

  it('running week: record null, items and adjustments listed, carriedIn from his latest settlement', () => {
    const f = week()
    doneTask(f, { score: 130, completedAt: plus(SAT, H), earner: f.starsi })
    settleLatest(f) // P1: carry 30
    const p2 = period(f, 2)
    const done = doneTask(f, { score: 8, completedAt: plus(p2.startsAt, H), earner: f.starsi })
    const adj = adjustment(f, f.starsi, 5, plus(p2.startsAt, 2 * H))
    const w = view(f, p2.id, f.starsi)
    expect(w.record).toBeNull()
    expect(w.items.map((i) => i.taskId)).toEqual([done])
    expect(w.adjustments.map((a) => a.id)).toEqual([adj])
    expect(w.carriedIn).toBe(30)
  })

  it('first week: carriedIn 0', () => {
    const f = week()
    expect(view(f, f.p1.id, f.starsi).carriedIn).toBe(0)
  })

  it('unknown period or user → null', () => {
    const f = week()
    expect(getAdminWeek(f.db, f.p1.id + 100, f.starsi)).toBeNull()
    expect(getAdminWeek(f.db, f.p1.id, f.mladsi + 100)).toBeNull()
  })

  it('shape: no other fields, no other user fields', () => {
    const f = week()
    const w = view(f, f.p1.id, f.starsi)
    expect(Object.keys(w)).toEqual(['taker', 'week', 'record', 'carriedIn', 'items', 'adjustments'])
    expect(Object.keys(w.taker)).toEqual(['id', 'name'])
  })
})
