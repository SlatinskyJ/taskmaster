import {
  acceptTemplateBidFn,
  acceptTemplateOfferFn,
  approveTemplateScoreFn,
  bidTemplateScoreFn,
  counterTemplateScoreFn,
  turnDownTemplateBidsFn,
  withdrawTemplateBidFn,
} from '~/server/templates/functions'
import type { TemplateActionResult } from '~/server/templates/functions'
import type { PriceCall } from './priceView'

// The one place a price button reaches the server (#138, #209). Components import no score
// server function themselves.

type Fn<D> = (args: { data: D }) => Promise<TemplateActionResult>
interface ScoreData {
  templateId: number
  score: number
}
type DataOf<A extends PriceCall['action']> = A extends 'withdraw'
  ? { templateId: number }
  : A extends 'turnDown'
    ? { templateId: number; bids: { takerId: number; score: number }[] }
    : ScoreData

export const PRICE_CALLS: { [A in PriceCall['action']]: Fn<DataOf<A>> } = {
  bid: bidTemplateScoreFn,
  counter: counterTemplateScoreFn,
  acceptBid: acceptTemplateBidFn,
  acceptOffer: acceptTemplateOfferFn,
  approve: approveTemplateScoreFn,
  withdraw: withdrawTemplateBidFn,
  turnDown: turnDownTemplateBidsFn,
}

export function callPrice(call: PriceCall): Promise<TemplateActionResult> {
  switch (call.action) {
    case 'withdraw':
      return PRICE_CALLS.withdraw({ data: call.data })
    case 'turnDown':
      return PRICE_CALLS.turnDown({ data: call.data })
    case 'bid':
      return PRICE_CALLS.bid({ data: call.data })
    case 'counter':
      return PRICE_CALLS.counter({ data: call.data })
    case 'acceptBid':
      return PRICE_CALLS.acceptBid({ data: call.data })
    case 'acceptOffer':
      return PRICE_CALLS.acceptOffer({ data: call.data })
    case 'approve':
      return PRICE_CALLS.approve({ data: call.data })
  }
}
