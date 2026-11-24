import { cs } from './strings'

/**
 * Czech message for a correction or point adjustment the server refused (#48: `FixError`
 * codes from src/server/corrections, or `feature_off`). Anything a person can't cause from
 * the screen gets the generic text.
 */
export function fixErrorMessage(error: string): string {
  const f = cs.admin.fix.errors
  const d = cs.admin.disputes.errors
  switch (error) {
    case 'week_waiting':
    case 'would_go_negative':
    case 'no_change':
    case 'reason_required':
      return f[error]
    case 'value_changed':
    case 'not_open':
    case 'not_found':
      return d[error]
    case 'feature_off':
      return cs.disputes.errors.feature_off
    default:
      return cs.disputes.errors.generic
  }
}
