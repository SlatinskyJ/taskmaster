import { isValidPeriodSettings, MAX_LENGTH_DAYS } from '~/domain/periods'
import type { Levels } from '~/domain'
import { addPragueDays, fromPragueWallTime, toPragueWallTime } from '~/domain/dates'
import type { ProposalView, ProposalsView } from '~/server/periods/functions'

// The Příští týden screen's rules, framework-free so they are tested without a DOM. Every date
// counts from the server's `next.startsAt`; the browser never works out the default week.

export interface NextWeekForm {
  lengthDays: number
  hour: number
  minute: number
  levels: Levels
}

interface Span {
  startsAt: Date
  cutoffAt: Date
  levels: Levels
}

/** Next week's cutoff: the Prague date of `nextStartsAt` plus `lengthDays`, at hour:minute. */
export function nextWeekCutoff(nextStartsAt: Date, f: NextWeekForm): Date {
  const day = toPragueWallTime(addPragueDays(nextStartsAt, f.lengthDays))
  return fromPragueWallTime({ ...day, hour: f.hour, minute: f.minute })
}

/** Whole Prague calendar days between two instants (for "7 dní" on the proposal card). */
export function lengthInDays(startsAt: Date, cutoffAt: Date): number {
  const a = toPragueWallTime(startsAt)
  const b = toPragueWallTime(cutoffAt)
  const days = (w: typeof a) => Date.UTC(w.year, w.month - 1, w.day) / 86_400_000
  return Math.round(days(b) - days(a))
}

/** The form's start values, from the server's `next` span. */
export function initialNextWeek(next: Span): NextWeekForm {
  const end = toPragueWallTime(next.cutoffAt)
  return {
    lengthDays: lengthInDays(next.startsAt, next.cutoffAt),
    hour: end.hour,
    minute: end.minute,
    levels: { ...next.levels },
  }
}

/** One day longer or shorter, within 1 … MAX_LENGTH_DAYS. */
export function stepDays(f: NextWeekForm, by: 1 | -1): NextWeekForm {
  return { ...f, lengthDays: Math.min(MAX_LENGTH_DAYS, Math.max(1, f.lengthDays + by)) }
}

/** The domain's own check, so the send button and the server share one cap. */
export function withinCap(nextStartsAt: Date, f: NextWeekForm): boolean {
  return isValidPeriodSettings(
    { cutoffAt: nextWeekCutoff(nextStartsAt, f), levels: f.levels },
    nextStartsAt,
  )
}

export interface MyActions {
  approve: boolean
  reject: boolean
  withdraw: boolean
}

/**
 * My buttons on a proposal: approve when I'm in waitingFor; reject for every party but the
 * proposer while pending ([call] one no ends it); withdraw for the proposer. Nothing once agreed.
 */
export function myActions(p: ProposalView<unknown>, me: number): MyActions {
  const pending = p.status === 'pending'
  const mine = p.proposedBy === me
  return {
    approve: pending && p.waitingFor.includes(me),
    reject: pending && !mine,
    withdraw: pending && mine,
  }
}

/**
 * "Who agreed": every party who approved (✓) or still has to ("čeká"). A giver who need not
 * approve, because another giver already did, is left out.
 */
export function agreementRows(
  p: ProposalView<unknown>,
  parties: ProposalsView['parties'],
): { id: number; name: string; agreed: boolean }[] {
  return parties
    .filter((x) => p.approvedBy.includes(x.id) || p.waitingFor.includes(x.id))
    .map((x) => ({ id: x.id, name: x.name, agreed: p.approvedBy.includes(x.id) }))
}

export type ProposalKind = 'period' | 'defaults'

/** Domů rows: the proposals waiting for `me`. */
export function waitingProposals(
  v: Pick<ProposalsView, 'period' | 'defaults'>,
  me: number,
): ProposalKind[] {
  const kinds: ProposalKind[] = []
  if (v.period?.waitingFor.includes(me)) kinds.push('period')
  if (v.defaults?.waitingFor.includes(me)) kinds.push('defaults')
  return kinds
}
