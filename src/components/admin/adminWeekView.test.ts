import { describe, expect, it } from 'vitest'
import type { AdminWeek } from '~/server/settlement/functions'
import { weekSoFar } from './adminWeekView'

const base: AdminWeek = {
  taker: { id: 2, name: 'Starší' },
  week: { periodId: 4, startsAt: '', endsAt: '', levels: { lower: 50, upper: 100 } },
  record: null,
  carriedIn: 8,
  items: [
    { taskId: 1, title: 'a', score: 20, status: 'confirmed', at: '' },
    { taskId: 2, title: 'b', score: 7, status: 'done_unconfirmed', at: '' },
    { taskId: 3, title: 'c', score: 4, status: 'done_unconfirmed', at: '' },
  ],
  adjustments: [
    { id: 1, points: 5, reason: '', at: '', fromWeek: null, waiting: false, dispute: null },
    { id: 2, points: -3, reason: '', at: '', fromWeek: null, waiting: false, dispute: null },
  ],
}

describe('weekSoFar', () => {
  it('carry-in, confirmed and adjustments are confirmed; waiting completions are pending', () => {
    expect(weekSoFar(base)).toEqual({ confirmed: 8 + 20 + 5 - 3, pending: 11 })
  })

  it('an empty first week: zero and zero', () => {
    expect(weekSoFar({ ...base, carriedIn: 0, items: [], adjustments: [] })).toEqual({
      confirmed: 0,
      pending: 0,
    })
  })
})
