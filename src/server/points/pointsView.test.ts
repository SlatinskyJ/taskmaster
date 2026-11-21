import { describe, expect, it } from 'vitest'
import { approveTask, approveTaskOffer, completeTask, createTask } from '~/server/tasks'
import { T0, T1, T2, T3, family, must, type Family } from '~/server/tasks/testing'
import { pointsView } from './points'

// What getPointsFn returns to whom (spec §5.7): its handler is exactly `pointsView`.

function confirmed(f: Family, taker: number, score: number) {
  const id = must(createTask(f.db, f.tata, { title: 'Úkol', score, approvalRequired: true }, T0)).id
  must(approveTaskOffer(f.db, taker, id, score, T1))
  must(completeTask(f.db, taker, id, T2))
  must(approveTask(f.db, f.tata, id, T3))
}

function withPoints() {
  const f = family()
  confirmed(f, f.starsi, 18)
  confirmed(f, f.mladsi, 7)
  return f
}

describe('pointsView', () => {
  it('gives a taker only his own row', () => {
    const f = withPoints()
    const view = pointsView(f.db, { id: f.starsi, role: 'taker' })
    expect(view.takers).toEqual([{ id: f.starsi, name: 'Starší', confirmed: 18, pending: 0 }])
    expect(JSON.stringify(view)).not.toContain('Mladší')
    expect(view.levels).toEqual({ lower: 50, upper: 100 })
  })

  it('gives a giver every taker', () => {
    const f = withPoints()
    expect(pointsView(f.db, { id: f.tata, role: 'giver' }).takers).toEqual([
      { id: f.starsi, name: 'Starší', confirmed: 18, pending: 0 },
      { id: f.mladsi, name: 'Mladší', confirmed: 7, pending: 0 },
    ])
  })

  it('gives a taker not in the list an empty list', () => {
    const f = withPoints()
    expect(pointsView(f.db, { id: 999, role: 'taker' }).takers).toEqual([])
  })
})
