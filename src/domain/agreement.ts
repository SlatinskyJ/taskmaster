import type { Person, PersonId } from './parties'
import { allParties, findPerson, isActiveGiver, isParty } from './parties'
import type { Result } from './result'
import { fail, ok } from './result'

// All-party score agreement (spec §3, §5.1, §5.2 path 1).
//
// "All parties" is evaluated **live**, at every check, from the current people list:
// - a party added while a proposal is in flight must approve it too;
// - a party deactivated while a proposal is in flight is no longer needed, and their earlier
//   approval is dropped: if they are reactivated later they must approve again.
//
// Caller duty: whenever people change (added, deactivated, reactivated; #26), run
// `resolveTemplate` / `resolveOneTime` on every proposal still in flight. That drops approvals
// of people who are no longer parties and promotes anything everyone left has approved;
// without it a proposal could wait forever for someone who is gone.
// ("Resolve" here, not "settle": settlement is the end-of-period accounting, spec §4.)
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

/** Drops approvals of people who are not parties right now (deactivated, or now admin). */
export function pruneApprovals(proposal: ScoreProposal, people: readonly Person[]): ScoreProposal {
  const parties = allParties(people)
  const approvedBy = proposal.approvedBy.filter((id) => parties.includes(id))
  return approvedBy.length === proposal.approvedBy.length ? proposal : { ...proposal, approvedBy }
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
  return ok(resolveTemplate({ status: 'proposed', proposal: proposal.value }, people))
}

/**
 * Promotes whatever is now fully approved: a proposed template becomes agreed, a pending
 * score change replaces the score, after dropping approvals of people who are no longer
 * parties. Call after any approval and on every proposal whenever people change.
 */
export function resolveTemplate(
  template: TemplateAgreement,
  people: readonly Person[],
): TemplateAgreement {
  if (template.status === 'proposed') {
    const proposal = pruneApprovals(template.proposal, people)
    if (isAgreed(proposal, people)) {
      return { status: 'agreed', score: proposal.score, pendingChange: null }
    }
    return proposal === template.proposal ? template : { status: 'proposed', proposal }
  }
  if (!template.pendingChange) return template
  const change = pruneApprovals(template.pendingChange, people)
  if (isAgreed(change, people)) {
    return { status: 'agreed', score: change.score, pendingChange: null }
  }
  return change === template.pendingChange ? template : { ...template, pendingChange: change }
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
  return ok(resolveTemplate(next, people))
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
  return ok(resolveTemplate({ ...template, pendingChange: proposal.value }, people))
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
  return ok(resolveOneTime({ status: 'proposed', offer: offer.value }, people))
}

/** Drops non-party approvals and opens a fully approved offer. Call whenever people change. */
export function resolveOneTime(
  task: OneTimeAgreement,
  people: readonly Person[],
): OneTimeAgreement {
  if (task.status !== 'proposed') return task
  const offer = pruneApprovals(task.offer, people)
  if (isAgreed(offer, people)) return { status: 'open', score: offer.score }
  return offer === task.offer ? task : { status: 'proposed', offer }
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
  return ok(resolveOneTime({ status: 'proposed', offer: approved.value }, people))
}
