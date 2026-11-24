import { describe, expect, it } from 'vitest'
import { fail, ok } from '~/domain/result'
import type { SettlementRow } from '~/server/db/schema'
import type { Period } from '~/domain'
import { settled } from './actions'
import { parseSettle, viewerOf } from './functions'

// Input checks and the response shape of the meeting server functions.

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
