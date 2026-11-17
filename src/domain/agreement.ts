import type { Person, PersonId } from './parties'
import type { BidBook } from './bids'
import { EMPTY_BOOK, pruneBook } from './bids'
import { allParties, findPerson, isActiveAs, isActiveGiver, isParty } from './parties'
import type { Result } from './result'
import { fail, ok } from './result'

// Score agreement (spec §3, §5.1, §5.2 path 1; Jakub 2026-11-17): a score is agreed once at
// least one active giver and one active taker have approved it. Proposing counts as approving.
//
// Approvals are checked **live** against the current people list (Jakub 2026-11-17): an
// approval only counts while its author is an active giver or taker. A deactivated person's
// approval is dropped; if they are reactivated later they must approve again.
//
// Caller duty: whenever people change (added, deactivated, reactivated, role changed; #26),
// run `resolveTemplate` / `resolveOneTime` on every proposal still in flight. That drops
// approvals that no longer count and promotes anything that is now agreed.
// ("Resolve" here, not "settle": settlement is the end-of-period accounting, spec §4.)

export type AgreementError =
  | 'invalid_score'
  | 'not_a_party'
  | 'not_a_giver'
  | 'already_approved'
  | 'not_proposed'
  | 'offer_changed'
  | 'not_agreed'
  | 'change_pending'
  | 'same_score'
  | 'not_a_taker'
  | 'no_bid'
  | 'no_offer'
  | 'no_bids'
  | 'not_involved'
  | 'score_frozen'
  | 'not_changeable'

/** Points must be a positive whole number. */
export function isValidScore(score: number): boolean {
  return Number.isInteger(score) && score > 0
}

/** One round of approval of a score. */
export interface ScoreProposal {
  score: number
  proposedBy: PersonId
  /** In order of approval; the proposer approves by proposing. */
  approvedBy: readonly PersonId[]
}

/** Starts a proposal. Proposing a score counts as approving it. */
export function proposeScore(
  people: readonly Person[],
  proposerId: PersonId,
  score: number,
): Result<ScoreProposal, AgreementError> {
  if (!isValidScore(score)) return fail('invalid_score')
  const proposer = findPerson(people, proposerId)
  if (!proposer || !isParty(proposer)) return fail('not_a_party')
  return ok({ score, proposedBy: proposerId, approvedBy: [proposerId] })
}

/** A party approves the proposed score. */
export function approveScore(
  proposal: ScoreProposal,
  people: readonly Person[],
  approverId: PersonId,
): Result<ScoreProposal, AgreementError> {
  const approver = findPerson(people, approverId)
  if (!approver || !isParty(approver)) return fail('not_a_party')
  if (proposal.approvedBy.includes(approverId)) return fail('already_approved')
  return ok({ ...proposal, approvedBy: [...proposal.approvedBy, approverId] })
}

/** Drops approvals of people who are not parties right now (deactivated, or now admin). */
export function pruneApprovals(proposal: ScoreProposal, people: readonly Person[]): ScoreProposal {
  const parties = allParties(people)
  const approvedBy = proposal.approvedBy.filter((id) => parties.includes(id))
  return approvedBy.length === proposal.approvedBy.length ? proposal : { ...proposal, approvedBy }
}

export type PartyRole = 'giver' | 'taker'

/** The sides that still need an approval: no current giver / no current taker approved yet. */
export function missingRoles(proposal: ScoreProposal, people: readonly Person[]): PartyRole[] {
  const approvers = proposal.approvedBy
    .map((id) => findPerson(people, id))
    .filter((p): p is Person => p !== undefined && isParty(p))
  const roles: PartyRole[] = ['giver', 'taker']
  return roles.filter((role) => !approvers.some((p) => p.role === role))
}

/** Agreed = at least one current giver and one current taker approved (spec §3). */
export function isAgreed(proposal: ScoreProposal, people: readonly Person[]): boolean {
  return missingRoles(proposal, people).length === 0
}

// ── Recurring templates (spec §5.1) ──────────────────────────────────────────────────────

export type TemplateAgreement =
  /** Not yet agreed: creates no instances. */
  | { status: 'proposed'; proposal: ScoreProposal }
  /**
   * Agreed at `score`. A score change in flight (`change`: takers' open bids and the giver side's
   * current offer) leaves `score` in force until someone accepts (spec §5.1; `scoreChange.ts`).
   * One change at a time.
   */
  | { status: 'agreed'; score: number; change: TemplateChange | null }

/** A template score change in flight: takers' open bids, and the giver side's offer (if any). */
export interface TemplateChange extends BidBook {
  offer: { score: number; proposedBy: PersonId } | null
}

/** A giver proposes a new template's score (only givers create templates, spec §3). */
export function proposeTemplate(
  people: readonly Person[],
  giverId: PersonId,
  score: number,
): Result<TemplateAgreement, AgreementError> {
  const giver = findPerson(people, giverId)
  if (!giver || !isActiveGiver(giver)) return fail('not_a_giver')
  const proposal = proposeScore(people, giverId, score)
  if (!proposal.ok) return proposal
  return ok(resolveTemplate({ status: 'proposed', proposal: proposal.value }, people))
}

/**
 * Drops approvals and change bids of people who are no longer parties, and promotes a proposed
 * template that is now fully approved. Call after any approval and whenever people change.
 */
export function resolveTemplate(
  template: TemplateAgreement,
  people: readonly Person[],
): TemplateAgreement {
  if (template.status === 'proposed') {
    const proposal = pruneApprovals(template.proposal, people)
    if (isAgreed(proposal, people)) return { status: 'agreed', score: proposal.score, change: null }
    return proposal === template.proposal ? template : { status: 'proposed', proposal }
  }
  if (!template.change) return template
  const change = liveTemplateBook(template.change, people)
  return change === template.change ? template : { ...template, change }
}

/** A template change without bids of people who are no longer takers. */
export function liveTemplateBook(
  change: TemplateChange,
  people: readonly Person[],
): TemplateChange {
  const book = pruneBook(change, (id) => isActiveAs(people, id, 'taker'))
  return book === change ? change : { ...change, bids: book.bids }
}

/** A party approves a proposed template's score. Score changes go through `scoreChange.ts`. */
export function approveTemplate(
  template: TemplateAgreement,
  people: readonly Person[],
  approverId: PersonId,
): Result<TemplateAgreement, AgreementError> {
  if (template.status !== 'proposed') return fail('not_proposed')
  const approved = approveScore(template.proposal, people, approverId)
  if (!approved.ok) return approved
  return ok(resolveTemplate({ status: 'proposed', proposal: approved.value }, people))
}

/** Instances can only come from an agreed template (spec §5.1). */
export function canCreateInstances(template: TemplateAgreement): boolean {
  return template.status === 'agreed'
}

/**
 * The score a new instance gets: the template's agreed score at the moment of creation.
 * A later score change applies only to instances created after it is agreed; existing
 * instances keep the score they were created with (spec §4, §5.1; Jakub 2026-11-17).
 */
export function scoreForNewInstance(template: TemplateAgreement): Result<number, AgreementError> {
  return template.status === 'agreed' ? ok(template.score) : fail('not_agreed')
}

// ── One-time tasks (spec §5.2) ──────────────────────────────────────────────────────────
// Two paths run in parallel; the first to finish wins:
//   1. score agreement: a taker approves the giver's offer → open (any taker may do it);
//   2. bidding (`bidding.ts`): a taker and the giver side agree on a number → reserved to that taker.
// Once a task is open or reserved, every action of either path is refused (`not_proposed`).

export type OneTimeAgreement =
  /** Negotiating: the giver's offer waiting for a taker's approval, and any open bids. */
  | { status: 'proposed'; offer: ScoreProposal; book: BidBook }
  /** A giver and a taker approved: in the queue at `score`, any taker may reserve or do it. */
  | { status: 'open'; score: number }
  /** Agreed by bidding between `takerId` and `giverId`: reserved to that taker (spec §5.2 path 2). */
  | { status: 'reserved'; score: number; takerId: PersonId; giverId: PersonId }

/** A giver creates a one-time task with an initial offer. */
export function createOneTimeTask(
  people: readonly Person[],
  giverId: PersonId,
  score: number,
): Result<OneTimeAgreement, AgreementError> {
  const giver = findPerson(people, giverId)
  if (!giver || !isActiveGiver(giver)) return fail('not_a_giver')
  const offer = proposeScore(people, giverId, score)
  if (!offer.ok) return offer
  return ok(resolveOneTime({ status: 'proposed', offer: offer.value, book: EMPTY_BOOK }, people))
}

/** The bid book without bids of people who no longer take part (spec §3, live). */
export function liveBook(book: BidBook, people: readonly Person[]): BidBook {
  return pruneBook(book, (id) => isActiveAs(people, id, 'taker'))
}

/**
 * Drops approvals and bids of people who no longer count, and opens a fully approved
 * offer. Call whenever people change.
 */
export function resolveOneTime(
  task: OneTimeAgreement,
  people: readonly Person[],
): OneTimeAgreement {
  if (task.status !== 'proposed') return task
  const offer = pruneApprovals(task.offer, people)
  if (isAgreed(offer, people)) return { status: 'open', score: offer.score }
  const book = liveBook(task.book, people)
  return offer === task.offer && book === task.book ? task : { ...task, offer, book }
}

/** A party approves the offered score; once a giver and a taker have, the task is open. */
export function approveOneTimeOffer(
  task: OneTimeAgreement,
  people: readonly Person[],
  approverId: PersonId,
): Result<OneTimeAgreement, AgreementError> {
  if (task.status !== 'proposed') return fail('not_proposed')
  const approved = approveScore(task.offer, people, approverId)
  if (!approved.ok) return approved
  return ok(resolveOneTime({ ...task, offer: approved.value }, people))
}

/**
 * A bid-won task was released (spec §5.4 [call]): negotiation restarts with the agreed score as
 * the current offer from the giver who agreed to it. Only one taker had agreed, so a taker's
 * approval is needed again. If that giver is no longer active, the offer waits for another
 * giver's approval as well (approvals are checked live).
 */
export function reopenOneTimeOffer(
  people: readonly Person[],
  giverId: PersonId,
  score: number,
): OneTimeAgreement {
  const offer: ScoreProposal = { score, proposedBy: giverId, approvedBy: [giverId] }
  return resolveOneTime({ status: 'proposed', offer, book: EMPTY_BOOK }, people)
}
