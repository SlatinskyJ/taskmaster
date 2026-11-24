import type { AgreementError, Negotiating, OneTimeAgreement } from './agreement'
import { isNegotiating, isValidScore, liveBook, proposeScore } from './agreement'
import type { OpenBid } from './bids'
import { EMPTY_BOOK, bidOf, lowestBid, placeBid } from './bids'
import type { Person, PersonId } from './parties'
import { isActiveAs } from './parties'
import type { Result } from './result'
import { fail, ok } from './result'

// Bidding on a one-time task (spec §5.2 path 2; Jakub 2026-11-17).
//
// - Takers bid. Each has at most one open bid; bidding again replaces it. A bid may be above the
//   offer (takers want more points); only takers' bids count for the lowest, givers don't bid.
// - The giver side counters by changing its offer. A counter is one offer to every taker, not to
//   one of them; it replaces the earlier offer (and its path-1 approvals).
// - A taker who has bid accepts the current offer: agreement + reservation to him in one step.
// - Every accept names the number the person saw, and a giver's accept or counter also names the
//   takers he saw holding it; if either changed meanwhile, it is refused (`offer_changed`).
// - A giver accepts the **lowest** open bid: one lowest bidder → reserved to that taker; a tie at
//   the lowest → open at that score, the tied takers sort it out.
// - A giver may change the offer any time while the task is proposed, bids or not; a counter at
//   exactly a taker's open bid accepts that bid (Jakub 2026-11-18, decisions 8a/8b).
// - Nothing is agreed automatically: every agreement is a person's action (accept or approve).
// - [call] Any active giver may counter or accept.
// - On agreement every open bid closes and pending approvals of the offer are dropped. Path 1
//   (approving the offer) and bidding race; the first to finish wins, after that every action is
//   refused with `not_proposed`.
//
// A reopened round on an open task (#212, status `rebidding`) runs by the same rules. Its opening
// offer is the agreed score by nobody (`offer.by: null`): nobody can say yes to it, taking the task
// at that score is reserving it. A giver's turn-down ends the round: open at the agreed score.
//
// The full history is not kept here: every bid, counter and acceptance is an append-only record
// and audit entry written by the caller. Results are `OneTimeAgreement`; when it turns `open` or
// `reserved`, the caller calls `markAgreed` on the lifecycle item (see README).

const taker = (people: readonly Person[], id: PersonId) => isActiveAs(people, id, 'taker')
const giver = (people: readonly Person[], id: PersonId) => isActiveAs(people, id, 'giver')

/** A taker bids (or re-bids) a score different from the current offer and his previous bid. */
export function placeOneTimeBid(
  task: OneTimeAgreement,
  people: readonly Person[],
  takerId: PersonId,
  score: number,
): Result<OneTimeAgreement, AgreementError> {
  if (!isNegotiating(task)) return fail('not_proposed')
  if (!taker(people, takerId)) return fail('not_a_taker')
  if (!isValidScore(score)) return fail('invalid_score')
  // Same number (Jakub 2026-11-24): never the offer; his previous bid only after a counter.
  if (score === task.offer.score || score === bidOf({ bids: task.lastBids }, takerId)?.score) {
    return fail('same_score')
  }
  return ok({
    ...task,
    book: placeBid(task.book, takerId, score),
    lastBids: placeBid({ bids: task.lastBids }, takerId, score).bids,
  })
}

/** A taker says no ("Nechci", Jakub 2026-11-24): only his own open bid closes. */
export function withdrawOneTimeBid(
  task: OneTimeAgreement,
  people: readonly Person[],
  takerId: PersonId,
): Result<OneTimeAgreement, AgreementError> {
  if (!isNegotiating(task)) return fail('not_proposed')
  if (!taker(people, takerId)) return fail('not_a_taker')
  if (!bidOf(task.book, takerId)) return fail('no_bid')
  return ok({ ...task, book: { bids: task.book.bids.filter((b) => b.by !== takerId) } })
}

/**
 * A giver turns the bidding down (Jakub 2026-11-24): every open bid closes and the task stays
 * proposed at the current offer, now offered by this giver (a new round: previous bids no longer
 * block a number). `seen` are the open bids he saw; if they changed meanwhile, `offer_changed`.
 */
export function turnDownOneTimeBids(
  task: OneTimeAgreement,
  people: readonly Person[],
  giverId: PersonId,
  seen: readonly OpenBid[],
): Result<OneTimeAgreement, AgreementError> {
  if (!isNegotiating(task)) return fail('not_proposed')
  if (!giver(people, giverId)) return fail('not_a_giver')
  const live = liveBook(task.book, people).bids
  // In a round it may come with no bids: a giver stops a round or takes back his counter.
  if (live.length === 0 && task.status === 'proposed') return fail('no_bids')
  const key = (b: OpenBid) => `${String(b.by)}:${String(b.score)}`
  if (!sameTakers(live.map(key), seen.map(key))) return fail('offer_changed')
  if (task.status === 'rebidding') return ok({ status: 'open', score: task.score })
  const offer = proposeScore(people, giverId, task.offer.score)
  if (!offer.ok) return offer
  return ok({ ...task, offer: offer.value, book: EMPTY_BOOK, lastBids: [] })
}

/**
 * A giver counters: a new offer to every taker. It replaces the current offer; approvals of the
 * old number are gone (only the countering giver has approved the new one). Open bids stay.
 *
 * Jakub 2026-11-18: a giver may counter any time while proposed, with or without bids (8a), and a
 * counter at exactly the number of takers' open bids accepts them (8b): one such taker → reserved
 * to him with this giver, several → open at that score (the tie rule). `bidders` are the takers
 * the giver saw at `score` (`[]` = none); if that set changed meanwhile, it is `offer_changed`.
 */
export function counterOneTimeOffer(
  task: OneTimeAgreement,
  people: readonly Person[],
  giverId: PersonId,
  score: number,
  bidders: readonly PersonId[],
): Result<OneTimeAgreement, AgreementError> {
  if (!isNegotiating(task)) return fail('not_proposed')
  if (!giver(people, giverId)) return fail('not_a_giver')
  if (!isValidScore(score)) return fail('invalid_score')
  if (score === task.offer.score) return fail('same_score')
  const atScore = liveBook(task.book, people)
    .bids.filter((b) => b.score === score)
    .map((b) => b.by)
  if (!sameTakers(atScore, bidders)) return fail('offer_changed')
  return agreeAt(score, atScore, giverId) ?? withOffer(task, people, giverId, score)
}

function withOffer(
  task: Negotiating,
  people: readonly Person[],
  giverId: PersonId,
  score: number,
): Result<OneTimeAgreement, AgreementError> {
  if (task.status === 'rebidding') {
    return ok({ ...task, offer: { score, by: giverId }, lastBids: [] })
  }
  const offer = proposeScore(people, giverId, score)
  if (!offer.ok) return offer
  return ok({ ...task, offer: offer.value, lastBids: [] })
}

/** The takers who hold a bid at `score`: one → reserved to him, several → open; none → null. */
function agreeAt(
  score: number,
  bidders: readonly PersonId[],
  giverId: PersonId,
): Result<OneTimeAgreement, AgreementError> | null {
  const [only, ...rest] = bidders
  if (only === undefined) return null
  if (rest.length === 0) return ok({ status: 'reserved', score, takerId: only, giverId })
  return ok({ status: 'open', score })
}

/** The same takers (or bids), in any order. A list that names one twice is never a match. */
export function sameTakers<T>(a: readonly T[], b: readonly T[]): boolean {
  const set = new Set(a)
  return (
    a.length === b.length &&
    set.size === a.length &&
    new Set(b).size === b.length &&
    b.every((id) => set.has(id))
  )
}

/**
 * A taker who has bid accepts the current offer: agreed at that score and reserved to him, with
 * the giver who made the offer. Without a bid, he approves the offer instead (path 1: open).
 * `score` is the number he accepted; if the offer changed meanwhile, it is refused.
 */
export function acceptOneTimeOffer(
  task: OneTimeAgreement,
  people: readonly Person[],
  takerId: PersonId,
  score: number,
): Result<OneTimeAgreement, AgreementError> {
  if (!isNegotiating(task)) return fail('not_proposed')
  if (!taker(people, takerId)) return fail('not_a_taker')
  if (!bidOf(task.book, takerId)) return fail('no_bid')
  const giverId = task.status === 'proposed' ? task.offer.proposedBy : task.offer.by
  if (giverId === null) return fail('no_offer')
  if (score !== task.offer.score) return fail('offer_changed')
  if (!giver(people, giverId)) return fail('not_a_giver')
  return ok({ status: 'reserved', score, takerId, giverId })
}

/**
 * A giver accepts the lowest open bid. One lowest bidder → reserved to that taker; a tie → open at
 * that score. `score` and `bidders` are the lowest bid the giver saw and every taker who held it
 * (any order); if either moved meanwhile, it is refused with `offer_changed`.
 */
export function acceptLowestBid(
  task: OneTimeAgreement,
  people: readonly Person[],
  giverId: PersonId,
  score: number,
  bidders: readonly PersonId[],
): Result<OneTimeAgreement, AgreementError> {
  if (!isNegotiating(task)) return fail('not_proposed')
  if (!giver(people, giverId)) return fail('not_a_giver')
  const lowest = lowestBid(liveBook(task.book, people))
  if (!lowest) return fail('no_bids')
  if (lowest.score !== score || !sameTakers(lowest.bidders, bidders)) return fail('offer_changed')
  return agreeAt(lowest.score, lowest.bidders, giverId) ?? fail('no_bids')
}
