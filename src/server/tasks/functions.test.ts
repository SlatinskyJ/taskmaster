import { describe, expect, it } from 'vitest'
import { fail, ok } from '~/domain/result'
import type { TaskRow } from '~/server/db/schema'
import {
  answered,
  parseAcceptBid,
  parseChangeAnswer,
  parseChangeProposal,
  parseCounter,
  parseReject,
  parseTurnDown,
  proposeTaskScoreChangeHandler,
  reopenBiddingHandler,
  turnDownBidsHandler,
  withdrawBidHandler,
} from './functions'
import { eq } from 'drizzle-orm'
import { featureFlags } from '~/server/db/schema'
import { placeBid } from './bidding'
import { reserveTask } from './lifecycle'
import { approveTaskOffer } from './tasks'
import { car, family, must, row, T0, T1, T2, thread } from './testing'

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

describe('price change and cancel inputs', () => {
  it('takes whole ids, a score up to 999 and an optional reason', () => {
    expect(parseChangeAnswer({ taskId: 1, changeId: 2 })).toEqual({ taskId: 1, changeId: 2 })
    expect(parseChangeProposal({ taskId: 1, score: 999 })).toEqual({ taskId: 1, score: 999 })
    expect(parseReject({ taskId: 1 })).toEqual({ taskId: 1, reason: undefined })
    expect(parseReject({ taskId: 1, reason: 'Udělá to firma.' })).toEqual({
      taskId: 1,
      reason: 'Udělá to firma.',
    })
  })
  it.each([
    [parseChangeAnswer, { taskId: 1, changeId: 2.5 }],
    [parseChangeAnswer, { taskId: '1', changeId: 2 }],
    [parseChangeAnswer, { taskId: 1 }],
    [parseChangeProposal, { taskId: 1, score: '20' }],
    [parseChangeProposal, { taskId: 1, score: 1000 }],
    [parseReject, { taskId: 1, reason: 5 }],
    [parseReject, null],
  ])('refuses bad input %#', (parse, input) => {
    expect(() => parse(input)).toThrow('Invalid input')
  })
})

describe('parseTurnDown (#208)', () => {
  const bid = (takerId: number, score: number) => ({ takerId, score })
  it('takes the task and the bids as shown', () => {
    expect(parseTurnDown({ taskId: 1, bids: [bid(3, 25), bid(4, 22)] })).toEqual({
      taskId: 1,
      bids: [bid(3, 25), bid(4, 22)],
    })
    const fifty = Array.from({ length: 50 }, (_, i) => bid(i + 1, 5))
    expect(parseTurnDown({ taskId: 1, bids: fifty }).bids).toHaveLength(50)
    expect(parseTurnDown({ taskId: 1, bids: [bid(3, 25)] }).bids).toEqual([bid(3, 25)])
  })
  it.each([
    ['no bids', { taskId: 1, bids: [] }],
    ['51 bids', { taskId: 1, bids: Array.from({ length: 51 }, (_, i) => bid(i + 1, 5)) }],
    ['a non-object bid', { taskId: 1, bids: [4] }],
    ['a fractional taker', { taskId: 1, bids: [bid(1.5, 5)] }],
    ['a score over the limit', { taskId: 1, bids: [bid(3, 1_000_000)] }],
    ['a taker twice', { taskId: 1, bids: [bid(3, 5), bid(3, 6)] }],
    ['no bids key', { taskId: 1 }],
  ])('refuses %s', (_, data) => {
    expect(() => parseTurnDown(data)).toThrow(/Invalid input/)
  })
})

describe('the bidRefusals switch (#208)', () => {
  const withSwitch = (enabled: boolean) => {
    const f = family()
    f.db.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, 'bidRefusals')).run()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    return { f, id }
  }
  it('off: both answer feature_off and nothing changes', () => {
    const { f, id } = withSwitch(false)
    expect(withdrawBidHandler(f.db, f.starsi, { taskId: id }, T2)).toEqual({
      ok: false,
      error: 'feature_off',
    })
    const bids = [{ takerId: f.starsi, score: 25 }]
    expect(turnDownBidsHandler(f.db, f.tata, { taskId: id, bids }, T2)).toEqual({
      ok: false,
      error: 'feature_off',
    })
    expect(thread(f.db, id)).toEqual([
      ['giver', f.tata, 18, null],
      ['taker', f.starsi, 25, null],
    ])
  })
  it('on: exactly ok, id and status', () => {
    const { f, id } = withSwitch(true)
    expect(withdrawBidHandler(f.db, f.starsi, { taskId: id }, T2)).toEqual({
      ok: true,
      id,
      status: 'proposed',
    })
    must(placeBid(f.db, f.mladsi, id, 22, T2))
    const bids = [{ takerId: f.mladsi, score: 22 }]
    expect(turnDownBidsHandler(f.db, f.tata, { taskId: id, bids }, T2)).toEqual({
      ok: true,
      id,
      status: 'proposed',
    })
  })
})

describe('the reopenBidding switch (#212)', () => {
  const openCar = (enabled: boolean) => {
    const f = family()
    f.db.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, 'reopenBidding')).run()
    const id = car(f)
    must(approveTaskOffer(f.db, f.starsi, id, 18, T0))
    return { f, id }
  }
  it('off: reopening answers feature_off and writes nothing', () => {
    const { f, id } = openCar(false)
    expect(reopenBiddingHandler(f.db, f.starsi, { taskId: id }, T1)).toEqual({
      ok: false,
      error: 'feature_off',
    })
    expect(row(f.db, id)?.biddingFrom).toBeNull()
  })
  it('on: exactly ok, id and status; the round has started', () => {
    const { f, id } = openCar(true)
    expect(reopenBiddingHandler(f.db, f.mladsi, { taskId: id }, T1)).toEqual({
      ok: true,
      id,
      status: 'open',
    })
    expect(row(f.db, id)?.biddingFrom).toBe(1)
  })
  it('on: Jiná cena is refused on an open task, accepted on a reserved one', () => {
    const { f, id } = openCar(true)
    const data = { taskId: id, score: 20 }
    expect(proposeTaskScoreChangeHandler(f.db, f.starsi, data, T1)).toEqual({
      ok: false,
      error: 'not_changeable',
    })
    must(reserveTask(f.db, f.starsi, id, T1))
    expect(proposeTaskScoreChangeHandler(f.db, f.starsi, data, T2)).toEqual({
      ok: true,
      id,
      status: 'reserved',
    })
  })
  it('off: Jiná cena on an open task works as before', () => {
    const { f, id } = openCar(false)
    expect(proposeTaskScoreChangeHandler(f.db, f.starsi, { taskId: id, score: 20 }, T1)).toEqual({
      ok: true,
      id,
      status: 'open',
    })
  })
})
