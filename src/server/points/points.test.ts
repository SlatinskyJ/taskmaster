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

const row = (f: Family, id: number) => takerPoints(f.db).takers.find((t) => t.id === id)

describe('takerPoints', () => {
  it('is zero for every taker with no tasks', () => {
    const f = family()
    expect(takerPoints(f.db)).toEqual({
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
    expect(takerPoints(f.db).takers.map((t) => [t.confirmed, t.pending])).toEqual([
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
    expect(takerPoints(f.db).takers.map((t) => t.id)).toEqual([f.starsi, f.mladsi])
  })
})
