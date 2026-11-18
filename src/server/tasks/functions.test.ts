import { describe, expect, it } from 'vitest'
import { parseAcceptBid, parseCounter } from './functions'

// Input checks of the bidding server functions (Security: no empty or huge bidders list).

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
