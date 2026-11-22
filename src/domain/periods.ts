import type { Weekday } from './dates'
import { addPragueDays, nextPragueWeekdayAt } from './dates'
import type { Person, PersonId } from './parties'
import { findPerson, isActiveAdmin, isActiveGiver, isActiveTaker, isParty } from './parties'
import type { Result } from './result'
import { fail, ok } from './result'
import type { Levels, PeriodId } from './settlement'
import { isValidLevels } from './settlement'

// Periods, attribution and period-setting proposals (spec §5.5, §5.8).
//
// A period runs from the end of the previous period to its own end. It is half-open,
// [startsAt, end): an instant exactly at the end already belongs to the next period, which
// matches the meeting listing items "completed before the period ends" (spec §5.9).
//
// The end is the cutoff, unless settling ended the period earlier (Jakub 2026-11-21, spec
// §5.8): the meeting normally runs before the cutoff, and confirming the settlement ends the
// running period at that moment (`endedAt`). The cutoff is the latest end.
//
// Periods are not tied to calendar weeks. The next period starts at the end, with or without
// a settlement ([call]). It takes the default settings in force at that moment, unless a
// different cutoff/levels for it reached period agreement before it started. Once started, its
// cutoff and levels never change.
//
// A per-period proposal is keyed on the period it follows (`afterPeriodId`), not on a start
// instant: after an early end the next period starts sooner than planned. It is open while the
// period it follows is running.
//
// Period agreement (spec §3, Jakub 2026-11-17) = every active taker and at least one active
// giver approved. Proposing counts as approving. The admin never counts. Approvals are checked
// live against the current people list when counting. Per Jakub's 2026-11-17 rule (no special
// handling for people becoming inactive), approvals are not pruned on deactivation.
//
// Caller duty: when people change, run `resolvePeriodProposal` on every pending proposal (it
// promotes a proposal that is now agreed). When a period starts (at its predecessor's cutoff or
// at an early end), run `lapsePeriodSettings` on pending proposals for it. Pending default proposals never lapse ([call]).

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
  | 'not_running'

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
/** [call] The longest default period: 52 weeks. */
export const MAX_LENGTH_DAYS = 364
/** The end of Sunday, 23:59 Europe/Prague (Jakub 2026-11-21, spec §5.8). */
export const DEFAULT_CUTOFF: CutoffTime = { weekday: 0, hour: 23, minute: 59 }
/** Default lower/upper levels (Jakub 2026-11-21, the spec's example numbers). */
export const DEFAULT_LEVELS: Levels = { lower: 50, upper: 100 }
/** The defaults in force until stored settings exist (#43, #47). */
export const DEFAULT_PERIOD_DEFAULTS: PeriodDefaults = {
  lengthDays: DEFAULT_LENGTH_DAYS,
  cutoff: DEFAULT_CUTOFF,
  levels: DEFAULT_LEVELS,
}

/** One period's span and levels. */
export interface PeriodSpan {
  startsAt: Date
  cutoffAt: Date
  levels: Levels
  /** Set when settling ended the period before its cutoff; null or absent otherwise. */
  endedAt?: Date | null
}

/** A stored period. */
export type Period = PeriodSpan & { id: PeriodId }

/** Where the period ends: the early end if settling ended it, else the cutoff. */
export function periodEnd(period: PeriodSpan): Date {
  return period.endedAt ?? period.cutoffAt
}

/** True while `now` is inside the period: startsAt ≤ now < end. */
export function isRunning(period: PeriodSpan, now: Date): boolean {
  const t = now.getTime()
  return period.startsAt.getTime() <= t && t < periodEnd(period).getTime()
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
    isWholeIn(lengthDays, 7, MAX_LENGTH_DAYS) &&
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
 * Sunday 23:59) nearest to `startsAt + lengthDays` (a tie goes to the later one), and always
 * after the start. A 7-day period from Sunday 23:59 ends the next Sunday 23:59. A period that
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
 * The period after `previous`: starts at its end. Uses `proposal`'s settings if it is agreed and
 * made for the period after `previous` (by id), else the defaults in force now.
 */
export function nextPeriod(
  previous: PeriodSpan & { id?: PeriodId },
  defaults: PeriodDefaults,
  proposal: PeriodSettingsProposal | null,
): PeriodSpan {
  const startsAt = periodEnd(previous)
  if (proposal?.status === 'agreed' && proposal.afterPeriodId === previous.id) {
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
  latest: PeriodSpan & { id?: PeriodId },
  now: Date,
  defaults: PeriodDefaults,
  proposal: PeriodSettingsProposal | null,
): PeriodSpan[] {
  const started: PeriodSpan[] = []
  let previous: PeriodSpan & { id?: PeriodId } = latest
  while (periodEnd(previous).getTime() <= now.getTime()) {
    previous = nextPeriod(previous, defaults, proposal)
    started.push(previous)
  }
  return started
}

/** True from the period's start on. Its cutoff and levels are then locked. */
export function hasStarted(period: PeriodSpan, now: Date): boolean {
  return now.getTime() >= period.startsAt.getTime()
}

/**
 * Settlement is allowed once the period has started (strictly after its first instant): before the cutoff it ends the running
 * period, after the cutoff it settles a period that ended there (spec §5.8). A period that
 * settling already ended early is settled. Double settlement of a period ended at its cutoff is
 * guarded by its settlement records (#44), not here.
 */
export function canSettle(period: PeriodSpan, now: Date): boolean {
  // Strictly after the start, like `endPeriodEarly`: a settlement can't end a zero-length period.
  return now.getTime() > period.startsAt.getTime() && period.endedAt == null
}

/**
 * The period the meeting settles (spec §5.8, §5.9 step 1). `periods` oldest first, `settled`
 * the ids that have settlement records. The oldest ended period without a settlement comes
 * first (a missed or late meeting; weeks are never skipped); only when every ended period is
 * settled, the running one, if it can be settled now. `undefined` = nothing to settle.
 */
export function periodToSettle<P extends Period>(
  periods: readonly P[],
  settled: ReadonlySet<PeriodId>,
  now: Date,
): P | undefined {
  const t = now.getTime()
  const ended = periods.find((p) => periodEnd(p).getTime() <= t && !settled.has(p.id))
  if (ended) return ended
  const running = periods.find((p) => isRunning(p, now))
  return running && !settled.has(running.id) && canSettle(running, now) ? running : undefined
}

/**
 * Settling ends the running period at `at` (spec §5.8). The next period starts at `at`, with its
 * cutoff from that start and the default length (Sunday 20:00 → the next Sunday 23:59), or the
 * agreed change for it. Refused unless startsAt < at < cutoffAt and the period has not ended.
 */
export function endPeriodEarly(
  period: PeriodSpan & { id?: PeriodId },
  at: Date,
  defaults: PeriodDefaults,
  proposal: PeriodSettingsProposal | null,
): Result<{ ended: PeriodSpan; next: PeriodSpan }, PeriodError> {
  const t = at.getTime()
  if (period.endedAt != null || t <= period.startsAt.getTime() || t >= period.cutoffAt.getTime()) {
    return fail('not_running')
  }
  const ended = { ...period, endedAt: at }
  return ok({ ended, next: nextPeriod(ended, defaults, proposal) })
}

/**
 * The period an instant belongs to: the one with startsAt ≤ instant < its end. Used with a
 * completion's `completedAt` (not approval time, spec §5.5). `undefined` if no period covers it.
 */
export function periodAt<P extends PeriodSpan>(
  periods: readonly P[],
  instant: Date,
): P | undefined {
  const t = instant.getTime()
  return periods.find((p) => p.startsAt.getTime() <= t && t < periodEnd(p).getTime())
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

/** A change of one period's cutoff/levels; the period is the one after `afterPeriodId`. */
export type PeriodSettingsProposal = PeriodProposal<PeriodSettings> & { afterPeriodId: PeriodId }
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
 * running period). `existing` = earlier proposals for that period; [call] refused while one is
 * pending, or once one is agreed (that one stands). Refused once `current` is no longer running:
 * the period after it has started.
 */
export function proposePeriodSettings(
  people: readonly Person[],
  proposerId: PersonId,
  current: Period,
  settings: PeriodSettings,
  existing: readonly PeriodSettingsProposal[],
  now: Date,
): Result<PeriodSettingsProposal, PeriodError> {
  if (!isPartyId(people, proposerId)) return fail('not_a_party')
  if (!isRunning(current, now)) return fail('already_started')
  // At most the planned start: an early end only moves the start earlier.
  if (!isValidPeriodSettings(settings, current.cutoffAt)) return fail('invalid_settings')
  if (hasPending(existing)) return fail('proposal_pending')
  if (hasAgreed(existing)) return fail('already_agreed')
  const proposal: PeriodSettingsProposal = {
    afterPeriodId: current.id,
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

/** The period a proposal follows is `current` and still running: its period has not started. */
const isOpenFor = (proposal: PeriodSettingsProposal, current: Period, now: Date) =>
  proposal.afterPeriodId === current.id && isRunning(current, now)

/**
 * A party approves a per-period change; refused once the period has started. `current` = the
 * running period (or the latest one).
 */
export function approvePeriodSettings(
  proposal: PeriodSettingsProposal,
  people: readonly Person[],
  approverId: PersonId,
  current: Period,
  now: Date,
): Result<PeriodSettingsProposal, PeriodError> {
  if (proposal.status === 'pending' && !isOpenFor(proposal, current, now)) {
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
 * the start (spec §5.8). `current` = the running period (or the latest one). Returns the
 * proposal unchanged otherwise.
 */
export function lapsePeriodSettings(
  proposal: PeriodSettingsProposal,
  current: Period,
  now: Date,
): PeriodSettingsProposal {
  if (proposal.status !== 'pending' || isOpenFor(proposal, current, now)) return proposal
  return { ...proposal, status: 'lapsed' }
}
