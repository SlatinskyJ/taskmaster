import { toIsoUtc } from '~/domain/dates'
import type { PeriodDefaults } from '~/domain'
import { cs } from '~/lib/strings'
import {
  approveProposalFn,
  proposeDefaultsFn,
  proposePeriodFn,
  rejectProposalFn,
  withdrawProposalFn,
} from '~/server/periods/functions'
import type { ProposalResult } from '~/server/periods/functions'
import { nextWeekCutoff } from './proposalView'
import type { NextWeekForm, ProposalKind } from './proposalView'

// The proposal screens' calls to the server and the Czech text for each refusal.

export type ProposalAction = 'approve' | 'reject' | 'withdraw'

const e = cs.proposals.errors

/** Czech message for a refused proposal call (codes from src/server/periods). */
export function proposalErrorMessage(code: string): string {
  switch (code) {
    case 'already_started':
      return e.alreadyStarted
    case 'proposal_pending':
      return e.pending
    case 'already_agreed':
      return e.alreadyAgreed
    case 'invalid_settings':
      return e.invalid
    case 'not_pending':
    case 'not_found':
      return e.gone
    case 'not_proposer':
    case 'not_a_party':
    case 'not_a_giver':
    case 'feature_off':
      return e.forbidden
    case 'no_running_period':
      return e.noWeek
    default:
      return e.failed
  }
}

const ACTION_FN = {
  approve: approveProposalFn,
  reject: rejectProposalFn,
  withdraw: withdrawProposalFn,
} as const

/** One button on one card: the call carries that card's own kind and id. */
export function callProposalAction(
  action: ProposalAction,
  kind: ProposalKind,
  id: number,
): Promise<ProposalResult> {
  return ACTION_FN[action]({ data: { kind, id } })
}

/** Proposes next week: the cutoff counted from the server's `next.startsAt`. */
export function proposeNextWeek(nextStartsAt: Date, f: NextWeekForm): Promise<ProposalResult> {
  return proposePeriodFn({
    data: {
      cutoffAt: toIsoUtc(nextWeekCutoff(nextStartsAt, f)),
      levels: { lower: f.levels.lower, upper: f.levels.upper },
    },
  })
}

export function proposeDefaults(d: PeriodDefaults): Promise<ProposalResult> {
  return proposeDefaultsFn({ data: d })
}

/** Runs one call: null when it went through, else the Czech text (a throw is the generic one). */
export async function attempt(call: () => Promise<ProposalResult>): Promise<string | null> {
  try {
    const r = await call()
    return r.ok ? null : proposalErrorMessage(r.error)
  } catch {
    return e.failed
  }
}

/** Nesouhlasím and Stáhnout návrh end a proposal, so they ask first; Souhlasím runs at once. */
export function asksFirst(action: ProposalAction): action is 'reject' | 'withdraw' {
  return action !== 'approve'
}

/** What a screen does around one call: its busy key, its error line, the toast and the reload. */
export interface CallUi {
  busy: (key: string | null) => void
  error: (text: string | null) => void
  success: (text: string) => void
  reload: () => Promise<void>
}

/**
 * Runs one call for a screen: busy while it runs; on a refusal or a throw the Czech text goes
 * to the error line and nothing else happens; on success the toast, then the reload.
 */
export async function runProposalCall(
  key: string,
  call: () => Promise<ProposalResult>,
  done: string,
  ui: CallUi,
): Promise<boolean> {
  ui.busy(key)
  ui.error(null)
  const failed = await attempt(call)
  ui.busy(null)
  if (failed) {
    ui.error(failed)
    return false
  }
  ui.success(done)
  await ui.reload()
  return true
}
