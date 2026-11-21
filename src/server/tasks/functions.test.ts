import { describe, expect, it } from 'vitest'
import { fail, ok } from '~/domain/result'
import type { TaskRow } from '~/server/db/schema'
import { answered, parseAcceptBid, parseCounter } from './functions'

// Input checks of the bidding server functions (Security: no empty, huge or repeated bidders
// list, no score above TASK_SCORE_MAX).

describe('bidding inputs', () => {
  const fifty = Array.from({ length: 50 }, (_, i) => i + 1)
  it.each([
    [
      { taskId: 1, score: 22, bidders: [4] },
      { taskId: 1, score: 22, bidders: [4] },
    ],
    [
      { taskId: 1, score: 22, bidders: fifty },
      { taskId: 1, score: 22, bidders: fifty },
    ],
    [
      { taskId: 1, score: 999, bidders: [4] },
      { taskId: 1, score: 999, bidders: [4] },
    ],
  ])('parseAcceptBid takes %j', (input, out) => {
    expect(parseAcceptBid(input)).toEqual(out)
  })
  it.each([
    { taskId: 1, score: 22 },
    { taskId: 1, score: 22, bidders: 4 },
    { taskId: 1, score: 22, bidders: [] },
    { taskId: 1, score: 22, bidders: [...fifty, 51] },
    { taskId: 1, score: 22, bidders: [4.5] },
    { taskId: 1, score: 22, bidders: ['4'] },
    { taskId: 'x', score: 22, bidders: [4] },
    { taskId: 1, score: 22, bidders: [4, 4] },
    { taskId: 1, score: 1000, bidders: [4] },
    null,
  ])('parseAcceptBid and parseCounter refuse %j', (input) => {
    expect(() => parseAcceptBid(input)).toThrow('Invalid input')
    if (!(input && Array.isArray(input.bidders) && input.bidders.length === 0))
      expect(() => parseCounter(input)).toThrow('Invalid input')
  })
  it('parseCounter takes an empty bidders list, refuses 51 or a missing list', () => {
    expect(parseCounter({ taskId: 1, score: 20, bidders: [] })).toEqual({
      taskId: 1,
      score: 20,
      bidders: [],
    })
    expect(parseCounter({ taskId: 1, score: 20, bidders: fifty })).toEqual({
      taskId: 1,
      score: 20,
      bidders: fifty,
    })
    expect(() => parseCounter({ taskId: 1, score: 20, bidders: [...fifty, 51] })).toThrow(
      'Invalid input',
    )
    expect(() => parseCounter({ taskId: 1, score: 20 })).toThrow('Invalid input')
  })
})

describe('answered (what every task action returns to a screen)', () => {
  it.each(['proposed', 'open', 'reserved'] as const)(
    '%s row → only ok, id and status',
    (status) => {
      const row = { id: 7, status, title: 'Umýt auto', score: 18 } as unknown as TaskRow
      expect(answered(ok(row))).toEqual({ ok: true, id: 7, status })
    },
  )
  it('a refusal passes through unchanged', () => {
    expect(answered(fail('offer_changed'))).toEqual({ ok: false, error: 'offer_changed' })
  })
})
