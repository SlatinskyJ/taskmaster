import type { AgreementError, OneTimeAgreement } from './agreement'
import { isValidScore, liveBook } from './agreement'
import { bidOf, counterTo, lowestBid, placeBid, placeCounter } from './bids'
import type { Person, PersonId } from './parties'
import { isActiveAs } from './parties'
import type { Result } from './result'
import { fail, ok } from './result'

// Bidding on a one-time task (spec §5.2 path 2; Jakub 2026-11-17).
//
// - Several takers may bid at once. Each has at most one open bid; bidding again replaces it.
// - The giver side may counter a taker's bid; that counter is the giver's offer to that taker.
// - A taker may accept the giver's current offer to them (the counter, else the task's offer):
//   agreement + reservation in one step.
// - The giver side accepts the **lowest** open bid: one lowest bidder → reserved to that taker; a tie
//   at the lowest → open at that score, the tied takers sort it out.
// - [call] Any active giver may counter or accept.
// - On agreement every open bid and counter closes, pending approvals of the offer are dropped.
//   Path 1 (approving the offer) and bidding race; the first to finish wins, after that every
//   action is refused with `not_proposed`.
//
// The full history is not kept here: every bid, counter and acceptance is an append-only record
// and audit entry written by the caller. Results are `OneTimeAgreement`; when it turns `open` or
// `reserved`, the caller calls `markAgreed` on the lifecycle item (see README).

type Proposed = Extract<OneTimeAgreement, { status: 'proposed' }>

const taker = (people: readonly Person[], id: PersonId) => isActiveAs(people, id, 'taker')
const giver = (people: readonly Person[], id: PersonId) => isActiveAs(people, id, 'giver')

/**
 * The giver side's current offer to this taker: a live counter to them, else the task's offer.
 * Counters of givers who are no longer active don't count (checked live, like approvals).
 */
export function currentOfferTo(
  task: Proposed,
  people: readonly Person[],
  takerId: PersonId,
): { score: number; giverId: PersonId } {
  const counter = counterTo(liveBook(task.book, people), takerId)
  return counter
    ? { score: counter.score, giverId: counter.by }
    : { score: task.offer.score, giverId: task.offer.proposedBy }
}

/** A taker bids (or re-bids) a score different from the giver's current offer to them. */
export function placeOneTimeBid(
  task: OneTimeAgreement,
  people: readonly Person[],
  takerId: PersonId,
  score: number,
): Result<OneTimeAgreement, AgreementError> {
  if (task.status !== 'proposed') return fail('not_proposed')
  if (!taker(people, takerId)) return fail('not_a_taker')
  if (!isValidScore(score)) return fail('invalid_score')
  if (
    score === currentOfferTo(task, people, takerId).score ||
    score === bidOf(task.book, takerId)?.score
  ) {
    return fail('same_score')
  }
  return ok({ ...task, book: placeBid(task.book, takerId, score) })
}

/** A giver counters one taker's open bid with a different score. */
export function counterOneTimeBid(
  task: OneTimeAgreement,
  people: readonly Person[],
  giverId: PersonId,
  takerId: PersonId,
  score: number,
): Result<OneTimeAgreement, AgreementError> {
  if (task.status !== 'proposed') return fail('not_proposed')
  if (!giver(people, giverId)) return fail('not_a_giver')
  if (!isValidScore(score)) return fail('invalid_score')
  const bid = bidOf(task.book, takerId)
  if (!bid || !taker(people, takerId)) return fail('no_bid')
  if (score === bid.score || score === counterTo(task.book, takerId)?.score) {
    return fail('same_score')
  }
  return ok({ ...task, book: placeCounter(task.book, { by: giverId, to: takerId, score }) })
}

/**
 * A taker who has bid accepts the giver side's current offer to them: agreed at that score and
 * reserved to them. The offering giver is the one who countered, else the one who offered.
 */
export function acceptOneTimeOffer(
  task: OneTimeAgreement,
  people: readonly Person[],
  takerId: PersonId,
): Result<OneTimeAgreement, AgreementError> {
  if (task.status !== 'proposed') return fail('not_proposed')
  if (!taker(people, takerId)) return fail('not_a_taker')
  if (!bidOf(task.book, takerId)) return fail('no_bid')
  const { score, giverId } = currentOfferTo(task, people, takerId)
  // The task's own offer from a giver who has left: another giver must counter first.
  if (!giver(people, giverId)) return fail('not_a_giver')
  return ok({ status: 'reserved', score, takerId, giverId })
}

/**
 * A giver accepts the lowest open bid. One lowest bidder → reserved to that taker; a tie → open at
 * that score.
 */
export function acceptLowestBid(
  task: OneTimeAgreement,
  people: readonly Person[],
  giverId: PersonId,
): Result<OneTimeAgreement, AgreementError> {
  if (task.status !== 'proposed') return fail('not_proposed')
  if (!giver(people, giverId)) return fail('not_a_giver')
  // Only bids of takers who are still active count.
  const lowest = lowestBid(liveBook(task.book, people))
  if (!lowest) return fail('no_bids')
  const [only, ...rest] = lowest.bidders
  if (only !== undefined && rest.length === 0) {
    return ok({ status: 'reserved', score: lowest.score, takerId: only, giverId })
  }
  return ok({ status: 'open', score: lowest.score })
}
