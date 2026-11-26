import {
  acceptLowestTaskBidFn,
  acceptOfferFn,
  approveTaskOfferFn,
  counterOfferFn,
  placeBidFn,
  reopenBiddingFn,
  turnDownBidsFn,
  withdrawBidFn,
} from '~/server/tasks/functions'
import type { RefusalResult } from '~/server/tasks/functions'
import type { BidAction, BidCall } from './taskView'

// The one place a bid button reaches the server (#34). Components import no bidding server
// function themselves.

/** The data of the call whose action names `A` (a call may name several actions). */
type DataOf<C, A> = C extends { action: infer X; data: infer D } ? (A extends X ? D : never) : never
type DataFor<A extends BidAction> = DataOf<BidCall, A>
type CallFor<A extends BidAction> = (args: { data: DataFor<A> }) => Promise<RefusalResult>

export const BID_CALLS: { [A in BidAction]: CallFor<A> } = {
  approveOffer: approveTaskOfferFn,
  acceptOffer: acceptOfferFn,
  placeBid: placeBidFn,
  acceptLowestTaskBid: acceptLowestTaskBidFn,
  counterOffer: counterOfferFn,
  withdrawBid: withdrawBidFn,
  turnDownBids: turnDownBidsFn,
  reopenBidding: reopenBiddingFn,
}

export function callBid(call: BidCall): Promise<RefusalResult> {
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
    case 'withdrawBid':
      return BID_CALLS.withdrawBid({ data: call.data })
    case 'turnDownBids':
      return BID_CALLS.turnDownBids({ data: call.data })
    case 'reopenBidding':
      return BID_CALLS.reopenBidding({ data: call.data })
  }
}
