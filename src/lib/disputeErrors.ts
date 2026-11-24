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

/**
 * Czech message for a dismissal (or, with #48, a correction) the server refused
 * (`DisputeServerError` codes, or `feature_off`). Anything else gets the generic text.
 */
export function adminDisputeErrorMessage(error: string): string {
  const e = cs.admin.disputes.errors
  switch (error) {
    case 'not_open':
    case 'value_changed':
    case 'note_required':
    case 'not_found':
      return e[error]
    case 'feature_off':
      return cs.disputes.errors.feature_off
    default:
      return cs.disputes.errors.generic
  }
}
