import type { AgreementError, ScoreProposal, TemplateAgreement } from './agreement'
import { approveScore, isAgreed, isValidScore, liveTemplateBook, proposeScore } from './agreement'
import { EMPTY_BOOK, bidOf, lowestBid, placeBid } from './bids'
import type { Item } from './lifecycle'
import type { Person, PersonId } from './parties'
import { isActiveAs } from './parties'
import type { Result } from './result'
import { fail, ok } from './result'

// Changing a score that is already agreed (spec §5.1, §5.2 "Changing the score…").
//
// Templates (Jakub 2026-11-17): a change runs like bidding. Any party bids; the first bid starts
// the change. Each party has one open bid (re-bid replaces it). The giver side accepts the
// lowest open bid and the template gets that score; nobody is reserved anything. The old score
// stays in force until then, and only instances created afterwards get the new score.
//
// One-time tasks:
//   - reserved: the reserving taker and a giver must both approve the new score;
//   - open: any party proposes, score agreement (a giver + a taker) approves it;
//   - done (pending or confirmed): frozen; only the admin corrects, via an adjustment.
// The old score stays until the change is agreed. One change at a time per task.
//
// As everywhere in the domain, bids and approvals count only while their author is active, and
// the caller writes each bid and approval as its own append-only record and audit entry.

const isTaker = (people: readonly Person[], id: PersonId) => isActiveAs(people, id, 'taker')
const isGiver = (people: readonly Person[], id: PersonId) => isActiveAs(people, id, 'giver')

// ── Templates ────────────────────────────────────────────────────────────────────────────

/** Any party bids a new score for an agreed template; the first bid starts the change. */
export function bidTemplateScore(
  template: TemplateAgreement,
  people: readonly Person[],
  partyId: PersonId,
  score: number,
): Result<TemplateAgreement, AgreementError> {
  if (template.status !== 'agreed') return fail('not_agreed')
  if (!isTaker(people, partyId) && !isGiver(people, partyId)) return fail('not_a_party')
  if (!isValidScore(score)) return fail('invalid_score')
  const book = template.change ? liveTemplateBook(template.change, people) : EMPTY_BOOK
  if (score === template.score || bidOf(book, partyId)?.score === score) return fail('same_score')
  return ok({ ...template, change: placeBid(book, partyId, score) })
}

/**
 * A giver accepts the lowest open bid: the template gets that score and the change closes.
 * Score agreement needs a taker (spec §3), so the lowest bid must include a taker's; if only
 * givers hold it, a taker accepts it instead (`acceptTemplateBid`).
 */
export function acceptLowestTemplateBid(
  template: TemplateAgreement,
  people: readonly Person[],
  giverId: PersonId,
): Result<TemplateAgreement, AgreementError> {
  if (template.status !== 'agreed') return fail('not_agreed')
  if (!template.change) return fail('no_bids')
  if (!isGiver(people, giverId)) return fail('not_a_giver')
  const lowest = lowestBid(liveTemplateBook(template.change, people))
  if (!lowest) return fail('no_bids')
  if (!lowest.bidders.some((id) => isTaker(people, id))) return fail('needs_taker')
  return ok({ status: 'agreed', score: lowest.score, change: null })
}

/** A taker accepts a giver's open bid in the change: agreed at that score. */
export function acceptTemplateBid(
  template: TemplateAgreement,
  people: readonly Person[],
  takerId: PersonId,
  giverId: PersonId,
): Result<TemplateAgreement, AgreementError> {
  if (template.status !== 'agreed') return fail('not_agreed')
  if (!template.change) return fail('no_bids')
  if (!isTaker(people, takerId)) return fail('not_a_taker')
  const bid = isGiver(people, giverId) ? bidOf(template.change, giverId) : undefined
  if (!bid) return fail('no_bid')
  return ok({ status: 'agreed', score: bid.score, change: null })
}

// ── One-time tasks ───────────────────────────────────────────────────────────────────────

/** Who must agree to change this item's score now, or why it can't change. */
function changeRule(
  item: Item,
): Result<{ kind: 'open' } | { kind: 'reserved'; takerId: PersonId }, AgreementError> {
  if (item.origin !== 'one_time') return fail('wrong_state')
  switch (item.status) {
    case 'open':
      return ok({ kind: 'open' })
    case 'reserved':
      return ok({ kind: 'reserved', takerId: item.reservation.takerId })
    case 'proposed':
      return fail('not_agreed')
    case 'done_unconfirmed':
    case 'confirmed':
      return fail('score_frozen')
    default:
      return fail('wrong_state')
  }
}

/** Agreed by the people this item's rule needs (reserved: that taker + a giver). */
export function isOneTimeChangeAgreed(
  item: Item,
  change: ScoreProposal,
  people: readonly Person[],
): boolean {
  const rule = changeRule(item)
  if (!rule.ok) return false
  if (rule.value.kind === 'open') return isAgreed(change, people)
  const { takerId } = rule.value
  return (
    isTaker(people, takerId) &&
    change.approvedBy.includes(takerId) &&
    change.approvedBy.some((id) => isGiver(people, id))
  )
}

/**
 * Proposes a new score for an agreed one-time task. Open: any party. Reserved: only the
 * reserving taker or a giver. Proposing counts as approving. `pending` is the change already in
 * flight, if any (one at a time).
 */
export function proposeOneTimeScoreChange(
  item: Item,
  currentScore: number,
  pending: ScoreProposal | null,
  people: readonly Person[],
  proposerId: PersonId,
  score: number,
): Result<ScoreProposal, AgreementError> {
  const rule = changeRule(item)
  if (!rule.ok) return rule
  if (pending) return fail('change_pending')
  if (score === currentScore) return fail('same_score')
  if (rule.value.kind === 'reserved' && proposerId !== rule.value.takerId) {
    if (!isGiver(people, proposerId)) return fail('not_involved')
  }
  return proposeScore(people, proposerId, score)
}

/**
 * Approves a pending score change. Returns the change and whether it is now agreed; once agreed
 * the caller sets the task's score to `change.score` and closes the change. On a reserved task
 * only its taker and givers approve.
 */
export function approveOneTimeScoreChange(
  item: Item,
  change: ScoreProposal,
  people: readonly Person[],
  approverId: PersonId,
): Result<{ change: ScoreProposal; agreed: boolean }, AgreementError> {
  const rule = changeRule(item)
  if (!rule.ok) return rule
  if (rule.value.kind === 'reserved' && approverId !== rule.value.takerId) {
    if (!isGiver(people, approverId)) return fail('not_involved')
  }
  const approved = approveScore(change, people, approverId)
  if (!approved.ok) return approved
  return ok({ change: approved.value, agreed: isOneTimeChangeAgreed(item, approved.value, people) })
}
