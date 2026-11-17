import type { AgreementError, ScoreProposal, TemplateAgreement, TemplateChange } from './agreement'
import {
  approveScore,
  isAgreed,
  isValidScore,
  liveTemplateBook,
  proposeScore,
  pruneApprovals,
} from './agreement'
import { bidOf, lowestBid, placeBid } from './bids'
import type { Item } from './lifecycle'
import type { Person, PersonId } from './parties'
import { isActiveAs } from './parties'
import type { Result } from './result'
import { fail, ok } from './result'

// Changing a score that is already agreed (spec §5.1, §5.2 "Changing the score…").
//
// Templates (Jakub 2026-11-17): a change runs like bidding. Takers bid; the first bid starts the
// change; each taker has one open bid (re-bid replaces it). The giver side doesn't bid: it
// counters with one offer to every taker (and may start a change that way). It ends only by a
// person's action: a giver accepts the lowest taker bid, or a taker accepts the giver's offer.
// Nobody is reserved anything. The old score stays in force until then, and only instances
// created afterwards get the new score.
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

const NO_CHANGE: TemplateChange = { bids: [], offer: null }

/** A taker bids a new score for an agreed template; the first bid starts the change. */
export function bidTemplateScore(
  template: TemplateAgreement,
  people: readonly Person[],
  takerId: PersonId,
  score: number,
): Result<TemplateAgreement, AgreementError> {
  if (template.status !== 'agreed') return fail('not_agreed')
  if (!isTaker(people, takerId)) return fail('not_a_taker')
  if (!isValidScore(score)) return fail('invalid_score')
  const change = template.change ? liveTemplateBook(template.change, people) : NO_CHANGE
  if (
    score === template.score ||
    score === change.offer?.score ||
    score === bidOf(change, takerId)?.score
  ) {
    return fail('same_score')
  }
  return ok({ ...template, change: { ...change, bids: placeBid(change, takerId, score).bids } })
}

/** A giver counters (or starts a change) with one new offer to every taker; it replaces the last. */
export function counterTemplateScore(
  template: TemplateAgreement,
  people: readonly Person[],
  giverId: PersonId,
  score: number,
): Result<TemplateAgreement, AgreementError> {
  if (template.status !== 'agreed') return fail('not_agreed')
  if (!isGiver(people, giverId)) return fail('not_a_giver')
  if (!isValidScore(score)) return fail('invalid_score')
  const change = template.change ?? NO_CHANGE
  if (score === template.score || score === change.offer?.score) return fail('same_score')
  return ok({ ...template, change: { ...change, offer: { score, proposedBy: giverId } } })
}

/**
 * A giver accepts the lowest taker bid: the template gets that score and the change closes.
 * `score` is the lowest bid the giver saw; if it moved meanwhile, it is refused.
 */
export function acceptLowestTemplateBid(
  template: TemplateAgreement,
  people: readonly Person[],
  giverId: PersonId,
  score: number,
): Result<TemplateAgreement, AgreementError> {
  if (template.status !== 'agreed') return fail('not_agreed')
  if (!isGiver(people, giverId)) return fail('not_a_giver')
  const lowest = template.change ? lowestBid(liveTemplateBook(template.change, people)) : null
  if (!lowest) return fail('no_bids')
  if (lowest.score !== score) return fail('offer_changed')
  return ok({ status: 'agreed', score: lowest.score, change: null })
}

/**
 * A taker accepts the giver side's offer: the template gets that score and the change closes.
 * `score` is the offer he saw; if it changed meanwhile, it is refused.
 */
export function acceptTemplateOffer(
  template: TemplateAgreement,
  people: readonly Person[],
  takerId: PersonId,
  score: number,
): Result<TemplateAgreement, AgreementError> {
  if (template.status !== 'agreed') return fail('not_agreed')
  if (!isTaker(people, takerId)) return fail('not_a_taker')
  const offer = template.change?.offer
  if (!offer) return fail('no_offer')
  if (offer.score !== score) return fail('offer_changed')
  return ok({ status: 'agreed', score: offer.score, change: null })
}

// ── One-time tasks ───────────────────────────────────────────────────────────────────────

/** Who must agree to change this item's score now, or why it can't change. */
function changeRule(
  item: Item,
): Result<{ kind: 'open' } | { kind: 'reserved'; takerId: PersonId }, AgreementError> {
  if (item.origin !== 'one_time') return fail('not_changeable')
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
      return fail('not_changeable')
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
 * Keeps a pending one-time change in step with the task. Returns the change with approvals of
 * people who left dropped, or `null` when the task can no longer change score (completed,
 * cancelled, expired, or back in negotiation after a release): the change is discarded.
 * Caller duty: run it on the pending change after every lifecycle step and people change, in
 * the same transaction, so a stale change never blocks a new one (`change_pending`).
 */
export function resolveOneTimeChange(
  item: Item,
  change: ScoreProposal,
  people: readonly Person[],
): ScoreProposal | null {
  return changeRule(item).ok ? pruneApprovals(change, people) : null
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
