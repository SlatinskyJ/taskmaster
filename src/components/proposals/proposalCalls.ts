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
