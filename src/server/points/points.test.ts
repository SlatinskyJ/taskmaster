import { describe, expect, it } from 'vitest'
import {
  approveTask,
  approveTaskOffer,
  completeTask,
  createTask,
  rejectTask,
  releaseTask,
  reserveTask,
} from '~/server/tasks'
import { T0, T1, T2, T3, family, must, type Family } from '~/server/tasks/testing'
import { periodDefaults } from '~/server/db/schema'
import { getPeriodDefaults, rollPeriods, savePeriodDefaults } from '~/server/periods'
import { getMeeting, settlePeriod } from '~/server/settlement/meeting'
import { doneTask, MEETING, plus, SAT, week } from '~/server/settlement/testing'
import { takerPoints } from './points'

// The points query (spec §5.7): confirmed = running total, pending = done and unconfirmed.

/** A one-time task Táta offers and the takers approve, so it is open. */
function openTask(f: Family, score: number, approvalRequired = true): number {
  const id = must(
    createTask(f.db, f.tata, { title: `Úkol ${String(score)}`, score, approvalRequired }, T0),
  ).id
  must(approveTaskOffer(f.db, f.starsi, id, score, T1))
  // Agreement may already be reached (spec §5.2); a second approval is then refused.
  approveTaskOffer(f.db, f.mladsi, id, score, T1)
  return id
}

const doneBy = (f: Family, taker: number, score: number, approvalRequired = true) => {
  const id = openTask(f, score, approvalRequired)
  must(completeTask(f.db, taker, id, T2))
  return id
}

const confirmedBy = (f: Family, taker: number, score: number) => {
  const id = doneBy(f, taker, score)
  must(approveTask(f.db, f.tata, id, T3))
  return id
}

const row = (f: Family, id: number) => takerPoints(f.db, T3).takers.find((t) => t.id === id)

describe('takerPoints', () => {
  it('is zero for every taker with no tasks', () => {
    const f = family()
    expect(takerPoints(f.db, T3)).toEqual({
      levels: { lower: 50, upper: 100 },
      takers: [
        { id: f.starsi, name: 'Starší', confirmed: 0, pending: 0 },
        { id: f.mladsi, name: 'Mladší', confirmed: 0, pending: 0 },
      ],
    })
  })

  it('counts a confirmed task for its earner only', () => {
    const f = family()
    confirmedBy(f, f.starsi, 18)
    expect(row(f, f.starsi)).toMatchObject({ confirmed: 18, pending: 0 })
    expect(row(f, f.mladsi)).toMatchObject({ confirmed: 0, pending: 0 })
  })

  it('counts a done, unconfirmed task as pending', () => {
    const f = family()
    doneBy(f, f.starsi, 18)
    expect(row(f, f.starsi)).toMatchObject({ confirmed: 0, pending: 18 })
  })

  it('confirms at once when no approval is needed', () => {
    const f = family()
    doneBy(f, f.starsi, 18, false)
    expect(row(f, f.starsi)).toMatchObject({ confirmed: 18, pending: 0 })
  })

  it('sums several tasks per taker', () => {
    const f = family()
    confirmedBy(f, f.starsi, 18)
    confirmedBy(f, f.starsi, 5)
    doneBy(f, f.starsi, 3)
    confirmedBy(f, f.mladsi, 7)
    expect(row(f, f.starsi)).toMatchObject({ confirmed: 23, pending: 3 })
    expect(row(f, f.mladsi)).toMatchObject({ confirmed: 7, pending: 0 })
  })

  it('ignores open, reserved, proposed, released and giver-completed tasks', () => {
    const f = family()
    openTask(f, 4)
    must(reserveTask(f.db, f.starsi, openTask(f, 6), T2))
    must(createTask(f.db, f.tata, { title: 'Nabídka', score: 9, approvalRequired: true }, T0))
    const released = openTask(f, 11)
    must(reserveTask(f.db, f.mladsi, released, T2))
    must(releaseTask(f.db, f.mladsi, released, T3))
    must(completeTask(f.db, f.tata, openTask(f, 13), T2))
    expect(takerPoints(f.db, T3).takers.map((t) => [t.confirmed, t.pending])).toEqual([
      [0, 0],
      [0, 0],
    ])
  })

  it('drops a rejected completion from pending', () => {
    const f = family()
    const id = doneBy(f, f.starsi, 18)
    must(rejectTask(f.db, f.tata, id, undefined, T3))
    expect(row(f, f.starsi)).toMatchObject({ confirmed: 0, pending: 0 })
  })

  it('leaves out admins and givers', () => {
    const f = family()
    expect(takerPoints(f.db, T3).takers.map((t) => t.id)).toEqual([f.starsi, f.mladsi])
  })
})

describe('takerPoints levels', () => {
  const NEW = { lower: 60, upper: 120 }

  it('with no running period, the stored defaults', () => {
    const f = family()
    f.db.update(periodDefaults).set({ lowerLevel: 60, upperLevel: 120 }).run()
    expect(takerPoints(f.db, T3).levels).toEqual(NEW)
  })

  it("the running period's levels, not a save made during it; the next period's after", () => {
    const f = family()
    const [first] = rollPeriods(f.db, T3, getPeriodDefaults(f.db))
    if (!first) throw new Error('no period')
    must(savePeriodDefaults(f.db, f.admin, { ...getPeriodDefaults(f.db), levels: NEW }, T3))
    expect(takerPoints(f.db, T3).levels).toEqual({ lower: 50, upper: 100 })
    const after = new Date(first.cutoffAt.getTime() + 1)
    rollPeriods(f.db, after, getPeriodDefaults(f.db))
    expect(takerPoints(f.db, after).levels).toEqual(NEW)
  })
})

describe('takerPoints after a settlement', () => {
  /** P1 with Starší 100 + 30 and Mladší 30 confirmed, settled at the meeting. */
  function settledWeek() {
    const f = week()
    doneTask(f, { score: 100, completedAt: plus(SAT, 3_600_000), earner: f.starsi })
    doneTask(f, { score: 30, completedAt: plus(SAT, 7_200_000), earner: f.starsi })
    doneTask(f, { score: 30, completedAt: plus(SAT, 7_200_000), earner: f.mladsi })
    expect(takerPoints(f.db, MEETING).takers.map((t) => t.confirmed)).toEqual([130, 30])
    const m = getMeeting(f.db, MEETING)
    const shown = m.period ? m.takers.map((t) => ({ takerId: t.id, total: t.total })) : []
    must(settlePeriod(f.db, f.tata, f.p1.id, shown, MEETING))
    return f
  }

  it('confirmed drops by the deduction: 130 → settle at upper → 30; below lower keeps all', () => {
    const f = settledWeek()
    expect(
      takerPoints(f.db, plus(MEETING, 1000)).takers.map((t) => [t.confirmed, t.pending]),
    ).toEqual([
      [30, 0],
      [30, 0],
    ])
  })

  it('next week: carry-over plus new confirmed, pending apart', () => {
    const f = settledWeek()
    doneTask(f, { score: 20, completedAt: plus(MEETING, 60_000), earner: f.starsi })
    doneTask(f, {
      score: 9,
      completedAt: plus(MEETING, 60_000),
      earner: f.mladsi,
      status: 'done_unconfirmed',
    })
    expect(
      takerPoints(f.db, plus(MEETING, 120_000)).takers.map((t) => [t.confirmed, t.pending]),
    ).toEqual([
      [50, 0],
      [30, 9],
    ])
  })
})
