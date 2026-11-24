import { cs } from './strings'

/**
 * Czech message for a dispute the server refused (`OpenDisputeError` codes from
 * src/server/disputes, or `feature_off`). Anything a person can't cause from the screen gets
 * the generic text.
 */
export function disputeErrorMessage(error: string): string {
  const e = cs.disputes.errors
  switch (error) {
    case 'not_locked':
    case 'dispute_open':
    case 'reason_required':
    case 'not_found':
    case 'not_a_party':
    case 'feature_off':
      return e[error]
    default:
      return e.generic
  }
}
