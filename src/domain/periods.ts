import type { Weekday } from './dates'
import { addPragueDays, nextPragueWeekdayAt } from './dates'
import type { Person, PersonId } from './parties'
import { findPerson, isActiveAdmin, isActiveGiver, isActiveTaker, isParty } from './parties'
import type { Result } from './result'
import { fail, ok } from './result'
import type { Levels } from './settlement'
import { isValidLevels } from './settlement'

// Periods, attribution and period-setting proposals (spec §5.5, §5.8).
//
// A period runs from the previous period's cutoff to its own cutoff. It is half-open,
// [startsAt, cutoffAt): an instant exactly at the cutoff already belongs to the next period,
// which matches the meeting listing items "completed before the cutoff" (spec §5.9).
//
// Periods are not tied to calendar weeks. The next period starts at the cutoff, with or without
// a settlement ([call]). It takes the default settings in force at that moment, unless a
// different cutoff/levels for it reached period agreement before it started. Once started, its
// cutoff and levels never change.
//
// Period agreement (spec §3, Jakub 2026-11-17) = every active taker and at least one active
// giver approved. Proposing counts as approving. The admin never counts. Approvals are checked
// live against the current people list when counting. Per Jakub's 2026-11-17 rule (no special
// handling for people becoming inactive), approvals are not pruned on deactivation.
//
// Caller duty: when people change, run `resolvePeriodProposal` on every pending proposal (it
// promotes a proposal that is now agreed). When a period starts, run `lapsePeriodSettings` on
// pending proposals for it. Pending default proposals never lapse ([call]).

export type PeriodError =
  | 'not_a_party'
  | 'not_a_giver'
  | 'not_admin'
  | 'invalid_settings'
  | 'already_started'
  | 'proposal_pending'
  | 'already_agreed'
  | 'not_pending'
  | 'already_approved'
  | 'not_proposer'

/** Weekday and Prague wall time of the default cutoff. */
export interface CutoffTime {
  weekday: Weekday
  hour: number
  minute: number
}

/** Global period settings (spec §5.8): length, cutoff, levels. */
export interface PeriodDefaults {
  lengthDays: number
  cutoff: CutoffTime
  levels: Levels
}

export const DEFAULT_LENGTH_DAYS = 7
/** [call] Sunday 18:00 Europe/Prague (spec §5.8). */
export const DEFAULT_CUTOFF: CutoffTime = { weekday: 0, hour: 18, minute: 0 }

/** One period's span and levels. The DB adds an id. */
export interface PeriodSpan {
  startsAt: Date
  cutoffAt: Date
  levels: Levels
}

/** A different cutoff and/or levels for one period, agreed before it starts (spec §5.8). */
export interface PeriodSettings {
  cutoffAt: Date
  levels: Levels
}

const isWholeIn = (n: number, min: number, max: number) =>
  Number.isInteger(n) && n >= min && n <= max

/**
 * [call] Length in whole weeks (7, 14, …), since the cutoff is a weekday and time; a real
 * weekday and wall time; valid levels.
 */
export function isValidDefaults(defaults: PeriodDefaults): boolean {
  const { lengthDays, cutoff, levels } = defaults
  return (
    isWholeIn(lengthDays, 7, 364) &&
    lengthDays % 7 === 0 &&
    isWholeIn(cutoff.weekday, 0, 6) &&
    isWholeIn(cutoff.hour, 0, 23) &&
    isWholeIn(cutoff.minute, 0, 59) &&
    isValidLevels(levels)
  )
}

/** A per-period change: valid levels and a cutoff after the period's start. */
export function isValidPeriodSettings(settings: PeriodSettings, startsAt: Date): boolean {
  return (
    !Number.isNaN(settings.cutoffAt.getTime()) &&
    settings.cutoffAt.getTime() > startsAt.getTime() &&
    isValidLevels(settings.levels)
  )
}

// ── Building the chain of periods ────────────────────────────────────────────────────────

/**
 * [call] The default cutoff of a period starting at `startsAt`: the default cutoff time (e.g.
 * Sunday 18:00) nearest to `startsAt + lengthDays` (a tie goes to the later one), and always
 * after the start. A 7-day period from Sunday 18:00 ends the next Sunday 18:00. A period that
 * starts on another day (after a one-off change) ends on the Sunday nearest a week later, which
 * brings the chain back to the default weekday.
 */
export function defaultCutoff(startsAt: Date, defaults: PeriodDefaults): Date {
  const { weekday, hour, minute } = defaults.cutoff
  const target = addPragueDays(startsAt, defaults.lengthDays)
  // The first default cutoff at or after the target, and the one a week before it.
  const after = nextPragueWeekdayAt(new Date(target.getTime() - 1), weekday, hour, minute)
  const before = addPragueDays(after, -7)
  if (before.getTime() <= startsAt.getTime()) return after
  const toAfter = after.getTime() - target.getTime()
  const toBefore = target.getTime() - before.getTime()
  return toBefore < toAfter ? before : after
}

/** The very first period: starts `now` and runs to the default cutoff. */
export function firstPeriod(now: Date, defaults: PeriodDefaults): PeriodSpan {
  return { startsAt: now, cutoffAt: defaultCutoff(now, defaults), levels: defaults.levels }
}

/**
 * The period after `previous`: starts at its cutoff. Uses `proposal`'s settings if it is agreed
 * and made for exactly this start, else the defaults in force now.
 */
export function nextPeriod(
  previous: PeriodSpan,
  defaults: PeriodDefaults,
  proposal: PeriodSettingsProposal | null,
): PeriodSpan {
  const startsAt = previous.cutoffAt
  if (proposal?.status === 'agreed' && proposal.periodStartsAt.getTime() === startsAt.getTime()) {
    return { startsAt, cutoffAt: proposal.settings.cutoffAt, levels: proposal.settings.levels }
  }
  return { startsAt, cutoffAt: defaultCutoff(startsAt, defaults), levels: defaults.levels }
}

/**
 * The periods that have started since `latest` by `now`, oldest first ([call]: the next period
 * starts at the cutoff even without a settlement). Usually none or one; more if the server was
 * down over several cutoffs. `proposal` (the agreed change for the next period, if any) can only
 * apply to the first of them.
 */
export function periodsToStart(
  latest: PeriodSpan,
  now: Date,
  defaults: PeriodDefaults,
  proposal: PeriodSettingsProposal | null,
): PeriodSpan[] {
  const started: PeriodSpan[] = []
  let previous = latest
  while (previous.cutoffAt.getTime() <= now.getTime()) {
    previous = nextPeriod(previous, defaults, proposal)
    started.push(previous)
  }
  return started
}

/** True from the period's start on. Its cutoff and levels are then locked. */
export function hasStarted(period: PeriodSpan, now: Date): boolean {
  return now.getTime() >= period.startsAt.getTime()
}

/** Settlement is allowed any time from the cutoff on (spec §5.8). */
export function canSettle(period: PeriodSpan, now: Date): boolean {
  return now.getTime() >= period.cutoffAt.getTime()
}

/**
 * The period an instant belongs to: the one with startsAt ≤ instant < cutoffAt. Used with a
 * completion's `completedAt` (not approval time, spec §5.5). `undefined` if no period covers it.
 */
export function periodAt<P extends PeriodSpan>(
  periods: readonly P[],
  instant: Date,
): P | undefined {
  const t = instant.getTime()
  return periods.find((p) => p.startsAt.getTime() <= t && t < p.cutoffAt.getTime())
}

// ── Proposals (period agreement) ─────────────────────────────────────────────────────────

export type PeriodProposalStatus = 'pending' | 'agreed' | 'rejected' | 'withdrawn' | 'lapsed'

export interface PeriodProposal<S> {
  settings: S
  proposedBy: PersonId
  /** In order of approval; the proposer approves by proposing. */
  approvedBy: readonly PersonId[]
  status: PeriodProposalStatus
  /** Who rejected or withdrew it; `null` otherwise. */
  closedBy: PersonId | null
}

/** A change of one period's cutoff/levels; the period is the one starting at `periodStartsAt`. */
export type PeriodSettingsProposal = PeriodProposal<PeriodSettings> & { periodStartsAt: Date }
export type DefaultsProposal = PeriodProposal<PeriodDefaults>

/** Every active taker and at least one active giver approved (spec §3), checked now. */
export function isPeriodAgreed(
  approvedBy: readonly PersonId[],
  people: readonly Person[],
): boolean {
  const approved = (p: Person) => approvedBy.includes(p.id)
  const takers = people.filter(isActiveTaker)
  return takers.every(approved) && people.filter(isActiveGiver).some(approved)
}

/** Promotes a pending proposal that has period agreement now. Call after people change. */
export function resolvePeriodProposal<P extends PeriodProposal<unknown>>(
  proposal: P,
  people: readonly Person[],
): P {
  if (proposal.status !== 'pending' || !isPeriodAgreed(proposal.approvedBy, people)) return proposal
  return { ...proposal, status: 'agreed' }
}

const hasPending = (proposals: readonly PeriodProposal<unknown>[]) =>
  proposals.some((p) => p.status === 'pending')
const hasAgreed = (proposals: readonly PeriodProposal<unknown>[]) =>
  proposals.some((p) => p.status === 'agreed')

function isPartyId(people: readonly Person[], id: PersonId): boolean {
  const person = findPerson(people, id)
  return person !== undefined && isParty(person)
}

/**
 * [call] Any party proposes a different cutoff/levels for the period after `current` (the
 * running period), so it starts at `current.cutoffAt`. `existing` = earlier proposals for that
 * period; [call] refused while one is pending, or once one is agreed (that one stands).
 */
export function proposePeriodSettings(
  people: readonly Person[],
  proposerId: PersonId,
  current: PeriodSpan,
  settings: PeriodSettings,
  existing: readonly PeriodSettingsProposal[],
  now: Date,
): Result<PeriodSettingsProposal, PeriodError> {
  const periodStartsAt = current.cutoffAt
  if (!isPartyId(people, proposerId)) return fail('not_a_party')
  if (now.getTime() >= periodStartsAt.getTime()) return fail('already_started')
  if (!isValidPeriodSettings(settings, periodStartsAt)) return fail('invalid_settings')
  if (hasPending(existing)) return fail('proposal_pending')
  if (hasAgreed(existing)) return fail('already_agreed')
  const proposal: PeriodSettingsProposal = {
    periodStartsAt,
    settings,
    proposedBy: proposerId,
    approvedBy: [proposerId],
    status: 'pending',
    closedBy: null,
  }
  return ok(resolvePeriodProposal(proposal, people))
}

/**
 * A giver proposes new default settings (spec §5.8). `existing` = earlier default proposals;
 * [call] at most one may be pending.
 */
export function proposeDefaults(
  people: readonly Person[],
  giverId: PersonId,
  defaults: PeriodDefaults,
  existing: readonly DefaultsProposal[],
): Result<DefaultsProposal, PeriodError> {
  const giver = findPerson(people, giverId)
  if (!giver || !isActiveGiver(giver)) return fail('not_a_giver')
  if (!isValidDefaults(defaults)) return fail('invalid_settings')
  if (hasPending(existing)) return fail('proposal_pending')
  const proposal: DefaultsProposal = {
    settings: defaults,
    proposedBy: giverId,
    approvedBy: [giverId],
    status: 'pending',
    closedBy: null,
  }
  return ok(resolvePeriodProposal(proposal, people))
}

/** The admin changes the defaults directly (spec §5.8). Pending proposals stay as they are. */
export function setDefaults(
  people: readonly Person[],
  adminId: PersonId,
  defaults: PeriodDefaults,
): Result<PeriodDefaults, PeriodError> {
  const admin = findPerson(people, adminId)
  if (!admin || !isActiveAdmin(admin)) return fail('not_admin')
  if (!isValidDefaults(defaults)) return fail('invalid_settings')
  return ok(defaults)
}

function approve<P extends PeriodProposal<unknown>>(
  proposal: P,
  people: readonly Person[],
  approverId: PersonId,
): Result<P, PeriodError> {
  if (proposal.status !== 'pending') return fail('not_pending')
  if (!isPartyId(people, approverId)) return fail('not_a_party')
  if (proposal.approvedBy.includes(approverId)) return fail('already_approved')
  const approved = { ...proposal, approvedBy: [...proposal.approvedBy, approverId] }
  return ok(resolvePeriodProposal(approved, people))
}

/** A party approves a per-period change; refused once the period has started. */
export function approvePeriodSettings(
  proposal: PeriodSettingsProposal,
  people: readonly Person[],
  approverId: PersonId,
  now: Date,
): Result<PeriodSettingsProposal, PeriodError> {
  if (proposal.status === 'pending' && now.getTime() >= proposal.periodStartsAt.getTime()) {
    return fail('already_started')
  }
  return approve(proposal, people, approverId)
}

/** A party approves a default-settings proposal. */
export function approveDefaults(
  proposal: DefaultsProposal,
  people: readonly Person[],
  approverId: PersonId,
): Result<DefaultsProposal, PeriodError> {
  return approve(proposal, people, approverId)
}

/**
 * [call] Any party rejects a pending proposal and it closes. Every taker's approval is needed,
 * so one taker's no ends it; a giver's no ends it too.
 */
export function rejectPeriodProposal<P extends PeriodProposal<unknown>>(
  proposal: P,
  people: readonly Person[],
  rejecterId: PersonId,
): Result<P, PeriodError> {
  if (proposal.status !== 'pending') return fail('not_pending')
  if (!isPartyId(people, rejecterId)) return fail('not_a_party')
  return ok({ ...proposal, status: 'rejected', closedBy: rejecterId })
}

/** The proposer withdraws a pending proposal. */
export function withdrawPeriodProposal<P extends PeriodProposal<unknown>>(
  proposal: P,
  withdrawerId: PersonId,
): Result<P, PeriodError> {
  if (proposal.status !== 'pending') return fail('not_pending')
  if (proposal.proposedBy !== withdrawerId) return fail('not_proposer')
  return ok({ ...proposal, status: 'withdrawn', closedBy: withdrawerId })
}

/**
 * A per-period change still pending when its period starts lapses: it needed agreement before
 * the start (spec §5.8). Returns the proposal unchanged otherwise.
 */
export function lapsePeriodSettings(
  proposal: PeriodSettingsProposal,
  now: Date,
): PeriodSettingsProposal {
  if (proposal.status !== 'pending' || now.getTime() < proposal.periodStartsAt.getTime()) {
    return proposal
  }
  return { ...proposal, status: 'lapsed' }
}
