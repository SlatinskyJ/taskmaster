import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acceptTemplateBidFn,
  acceptTemplateOfferFn,
  approveTemplateScoreFn,
  bidTemplateScoreFn,
  counterTemplateScoreFn,
  turnDownTemplateBidsFn,
  withdrawTemplateBidFn,
} from '~/server/templates/functions'
import { callPrice } from './priceCalls'
import type { PriceCall } from './priceView'

// Each price button reaches exactly its own server function, with its data unchanged (#138, #209).
vi.mock('~/server/templates/functions', () => {
  const fn = () => vi.fn(() => Promise.resolve({ ok: true, id: 7, score: 3 }))
  return {
    bidTemplateScoreFn: fn(),
    counterTemplateScoreFn: fn(),
    acceptTemplateBidFn: fn(),
    acceptTemplateOfferFn: fn(),
    approveTemplateScoreFn: fn(),
    withdrawTemplateBidFn: fn(),
    turnDownTemplateBidsFn: fn(),
  }
})

describe('callPrice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it.each([
    { action: 'bid', data: { templateId: 7, score: 6 } },
    { action: 'counter', data: { templateId: 7, score: 4 } },
    { action: 'acceptBid', data: { templateId: 7, score: 5 } },
    { action: 'acceptOffer', data: { templateId: 7, score: 4 } },
    { action: 'approve', data: { templateId: 7, score: 10 } },
    { action: 'withdraw', data: { templateId: 7 } },
    { action: 'turnDown', data: { templateId: 7, bids: [{ takerId: 4, score: 12 }] } },
  ] satisfies PriceCall[])('sends $action to its own server function only', async (call) => {
    await callPrice(call)
    const fns = {
      bid: bidTemplateScoreFn,
      counter: counterTemplateScoreFn,
      acceptBid: acceptTemplateBidFn,
      acceptOffer: acceptTemplateOfferFn,
      approve: approveTemplateScoreFn,
      withdraw: withdrawTemplateBidFn,
      turnDown: turnDownTemplateBidsFn,
    }
    for (const [action, fn] of Object.entries(fns)) {
      if (action === call.action) expect(fn).toHaveBeenCalledExactlyOnceWith({ data: call.data })
      else expect(fn).not.toHaveBeenCalled()
    }
  })
})
