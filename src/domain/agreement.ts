import type { Person, PersonId } from './parties'
import { allParties, findPerson, isActiveGiver, isParty } from './parties'
import type { Result } from './result'
import { fail, ok } from './result'

// All-party score agreement (spec §3, §5.1, §5.2 path 1).
//
// "All parties" is evaluated **live**, at every check, from the current people list:
// - a party added while a proposal is in flight must approve it too;
// - a party deactivated while a proposal is in flight is no longer needed, and their earlier
//   approval no longer counts. If that leaves every remaining party approved, the proposal is
//   agreed at the next `settle…` call (the caller runs it after changing people).
// The spec doesn't say what happens to in-flight proposals when the parties change; this is
// the default proposed to Jakub on #19.

export type AgreementError =
  | 'invalid_score'
  | 'not_a_party'
  | 'not_a_giver'
  | 'already_approved'
  | 'not_proposed'
  | 'not_agreed'
  | 'change_pending'
  | 'no_change_pending'
  | 'same_score'

/** Points must be a positive whole number. */
export function isValidScore(score: number): boolean {
  return Number.isInteger(score) && score > 0
}

/** One round of all-party approval of a score. */
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

/** Current parties who have not approved yet. */
export function missingApprovals(proposal: ScoreProposal, people: readonly Person[]): PersonId[] {
  return allParties(people).filter((id) => !proposal.approvedBy.includes(id))
}

/** Agreed = every current party approved. With no parties at all, nothing is ever agreed. */
export function isAgreed(proposal: ScoreProposal, people: readonly Person[]): boolean {
  return allParties(people).length > 0 && missingApprovals(proposal, people).length === 0
}

// ── Recurring templates (spec §5.1) ──────────────────────────────────────────────────────

export type TemplateAgreement =
  /** Not yet agreed: creates no instances. */
  | { status: 'proposed'; proposal: ScoreProposal }
  /** Agreed at `score`. A score change in flight leaves `score` in force until it is agreed. */
  | { status: 'agreed'; score: number; pendingChange: ScoreProposal | null }

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
  return ok(settleTemplate({ status: 'proposed', proposal: proposal.value }, people))
}

/**
 * Promotes whatever is now fully approved: a proposed template becomes agreed, a pending
 * score change replaces the score. Call after any approval or change of people.
 */
export function settleTemplate(
  template: TemplateAgreement,
  people: readonly Person[],
): TemplateAgreement {
  if (template.status === 'proposed') {
    return isAgreed(template.proposal, people)
      ? { status: 'agreed', score: template.proposal.score, pendingChange: null }
      : template
  }
  if (template.pendingChange && isAgreed(template.pendingChange, people)) {
    return { status: 'agreed', score: template.pendingChange.score, pendingChange: null }
  }
  return template
}

/** A party approves the template's proposed score, or its pending score change. */
export function approveTemplate(
  template: TemplateAgreement,
  people: readonly Person[],
  approverId: PersonId,
): Result<TemplateAgreement, AgreementError> {
  const proposal = template.status === 'proposed' ? template.proposal : template.pendingChange
  if (!proposal) return fail('no_change_pending')
  const approved = approveScore(proposal, people, approverId)
  if (!approved.ok) return approved
  const next: TemplateAgreement =
    template.status === 'proposed'
      ? { status: 'proposed', proposal: approved.value }
      : { ...template, pendingChange: approved.value }
  return ok(settleTemplate(next, people))
}

/**
 * Proposes a new score for an agreed template. Needs all parties again; the old score stays
 * in force until then (spec §5.1). One change at a time.
 */
export function proposeTemplateScoreChange(
  template: TemplateAgreement,
  people: readonly Person[],
  proposerId: PersonId,
  score: number,
): Result<TemplateAgreement, AgreementError> {
  if (template.status !== 'agreed') return fail('not_agreed')
  if (template.pendingChange) return fail('change_pending')
  if (score === template.score) return fail('same_score')
  const proposal = proposeScore(people, proposerId, score)
  if (!proposal.ok) return proposal
  return ok(settleTemplate({ ...template, pendingChange: proposal.value }, people))
}

/** Instances can only come from an agreed template (spec §5.1). */
export function canCreateInstances(template: TemplateAgreement): boolean {
  return template.status === 'agreed'
}

/**
 * The score a new instance gets: the template's agreed score at the moment of creation.
 * [call] A later score change applies only to instances created after it is agreed; existing
 * instances keep the score they were created with (spec §4, §5.1).
 */
export function scoreForNewInstance(template: TemplateAgreement): Result<number, AgreementError> {
  return template.status === 'agreed' ? ok(template.score) : fail('not_agreed')
}

// ── One-time tasks, path 1: all-party approval (spec §5.2) ───────────────────────────────
// Path 2 (bidding) and the race between the two paths arrive with #20.

export type OneTimeAgreement =
  /** The giver's offer, waiting for every party. */
  | { status: 'proposed'; offer: ScoreProposal }
  /** All parties approved: in the queue at `score`, anyone may reserve or do it. */
  | { status: 'open'; score: number }

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
  return ok(settleOneTime({ status: 'proposed', offer: offer.value }, people))
}

/** Promotes a fully approved offer to open. Call after any approval or change of people. */
export function settleOneTime(task: OneTimeAgreement, people: readonly Person[]): OneTimeAgreement {
  if (task.status === 'proposed' && isAgreed(task.offer, people)) {
    return { status: 'open', score: task.offer.score }
  }
  return task
}

/** A party approves the offered score; once every party has, the task is open. */
export function approveOneTimeOffer(
  task: OneTimeAgreement,
  people: readonly Person[],
  approverId: PersonId,
): Result<OneTimeAgreement, AgreementError> {
  if (task.status !== 'proposed') return fail('not_proposed')
  const approved = approveScore(task.offer, people, approverId)
  if (!approved.ok) return approved
  return ok(settleOneTime({ status: 'proposed', offer: approved.value }, people))
}
