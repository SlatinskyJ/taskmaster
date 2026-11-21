import { cs } from './strings'

/**
 * Czech message for a meeting confirm the server refused (`SettleError` codes from
 * src/server/settlement). Rulings on PR #175: a week already settled reads the same however it
 * was refused; anything a giver can't cause from the screen gets the generic text.
 */
export function settleErrorMessage(error: string): string {
  const e = cs.meeting.errors
  switch (error) {
    case 'totals_changed':
      return e.totalsChanged
    case 'pending_items':
      return e.pendingItems
    case 'already_settled':
    case 'wrong_period':
    case 'nothing_to_settle':
      return e.alreadySettled
    case 'no_takers':
      return e.noTakers
    default:
      return e.generic
  }
}
