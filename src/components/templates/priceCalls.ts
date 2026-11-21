import {
  acceptTemplateBidFn,
  acceptTemplateOfferFn,
  bidTemplateScoreFn,
  counterTemplateScoreFn,
} from '~/server/templates/functions'
import type { TemplateActionResult } from '~/server/templates/functions'
import type { PriceCall } from './priceView'

// The one place a price button reaches the server (#138). Components import no score change
// server function themselves.

type Call = (args: { data: PriceCall['data'] }) => Promise<TemplateActionResult>

export const PRICE_CALLS: Record<PriceCall['action'], Call> = {
  bid: bidTemplateScoreFn,
  counter: counterTemplateScoreFn,
  acceptBid: acceptTemplateBidFn,
  acceptOffer: acceptTemplateOfferFn,
}

export function callPrice(call: PriceCall): Promise<TemplateActionResult> {
  return PRICE_CALLS[call.action]({ data: call.data })
}
