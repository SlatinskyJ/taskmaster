import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acceptLowestTaskBidFn,
  acceptOfferFn,
  approveTaskOfferFn,
  counterOfferFn,
  placeBidFn,
  turnDownBidsFn,
  withdrawBidFn,
} from '~/server/tasks/functions'
import { BID_CALLS, callBid } from './bidCalls'
import type { BidCall } from './taskView'

// Each bid button reaches exactly its own server function, with its data unchanged (#34).
vi.mock('~/server/tasks/functions', () => {
  const fn = () => vi.fn(() => Promise.resolve({ ok: true, id: 1, status: 'proposed' }))
  return {
    approveTaskOfferFn: fn(),
    acceptOfferFn: fn(),
    placeBidFn: fn(),
    acceptLowestTaskBidFn: fn(),
    counterOfferFn: fn(),
    withdrawBidFn: fn(),
    turnDownBidsFn: fn(),
  }
})

describe('callBid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it.each([
    { action: 'approveOffer', data: { taskId: 1, score: 18 } },
    { action: 'acceptOffer', data: { taskId: 1, score: 18 } },
    { action: 'placeBid', data: { taskId: 1, score: 24 } },
    { action: 'acceptLowestTaskBid', data: { taskId: 1, score: 22, bidders: [4] } },
    { action: 'counterOffer', data: { taskId: 1, score: 21, bidders: [] } },
    { action: 'withdrawBid', data: { taskId: 1 } },
    { action: 'turnDownBids', data: { taskId: 1, bids: [{ takerId: 3, score: 25 }] } },
  ] satisfies BidCall[])(
    'callBid sends $action to its own server function only, with its data as is',
    async (call) => {
      await callBid(call)
      const fns = {
        approveOffer: approveTaskOfferFn,
        acceptOffer: acceptOfferFn,
        placeBid: placeBidFn,
        acceptLowestTaskBid: acceptLowestTaskBidFn,
        counterOffer: counterOfferFn,
        withdrawBid: withdrawBidFn,
        turnDownBids: turnDownBidsFn,
      }
      for (const [action, fn] of Object.entries(fns)) {
        if (action === call.action) expect(fn).toHaveBeenCalledExactlyOnceWith({ data: call.data })
        else expect(fn).not.toHaveBeenCalled()
      }
    },
  )
  it('every action calls its own server function', () => {
    expect(BID_CALLS).toEqual({
      approveOffer: approveTaskOfferFn,
      acceptOffer: acceptOfferFn,
      placeBid: placeBidFn,
      acceptLowestTaskBid: acceptLowestTaskBidFn,
      counterOffer: counterOfferFn,
      withdrawBid: withdrawBidFn,
      turnDownBids: turnDownBidsFn,
    })
  })
})
