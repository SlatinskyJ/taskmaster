import {
  acceptLowestTaskBidFn,
  acceptOfferFn,
  approveTaskOfferFn,
  counterOfferFn,
  placeBidFn,
} from '~/server/tasks/functions'
import type { TaskActionResult } from '~/server/tasks/functions'
import type { BidAction, BidCall } from './taskView'

// The one place a bid button reaches the server (#34). Components import no bidding server
// function themselves.

type WithBidders = Extract<BidCall, { data: { bidders: number[] } }>
type DataFor<A extends BidAction> = A extends WithBidders['action']
  ? WithBidders['data']
  : Exclude<BidCall, WithBidders>['data']
type CallFor<A extends BidAction> = (args: { data: DataFor<A> }) => Promise<TaskActionResult>

export const BID_CALLS: { [A in BidAction]: CallFor<A> } = {
  approveOffer: approveTaskOfferFn,
  acceptOffer: acceptOfferFn,
  placeBid: placeBidFn,
  acceptLowestTaskBid: acceptLowestTaskBidFn,
  counterOffer: counterOfferFn,
}

export function callBid(call: BidCall): Promise<TaskActionResult> {
  switch (call.action) {
    case 'approveOffer':
      return BID_CALLS.approveOffer({ data: call.data })
    case 'acceptOffer':
      return BID_CALLS.acceptOffer({ data: call.data })
    case 'placeBid':
      return BID_CALLS.placeBid({ data: call.data })
    case 'acceptLowestTaskBid':
      return BID_CALLS.acceptLowestTaskBid({ data: call.data })
    case 'counterOffer':
      return BID_CALLS.counterOffer({ data: call.data })
  }
}
