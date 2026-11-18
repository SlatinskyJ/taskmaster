import { cs } from './strings'
import { REASON_MAX, TASK_TITLE_MAX } from './taskLimits'

/** Czech message for a task action that the server refused (error codes from src/server/tasks). */
export function taskErrorMessage(error: string): string {
  switch (error) {
    case 'invalid_title':
      return cs.tasks.errors.invalidTitle(TASK_TITLE_MAX)
    case 'invalid_score':
      return cs.tasks.errors.invalidScore
    case 'offer_changed':
      return cs.tasks.errors.offerChanged
    case 'not_proposed':
    case 'not_found':
    case 'wrong_state':
      return cs.tasks.errors.gone
    case 'reserved_by_other':
      return cs.tasks.errors.reservedByOther
    case 'not_allowed':
    case 'not_a_giver':
    case 'not_a_taker':
      return cs.tasks.errors.notAllowed
    case 'invalid_schedule':
      return cs.templates.errors.invalidSchedule
    case 'invalid_deadline':
      return cs.templates.errors.invalidDeadline
    case 'already_approved':
      return cs.templates.errors.alreadyApproved
    case 'same_score':
      return cs.tasks.errors.sameScore
    case 'no_bids':
      return cs.tasks.errors.noBids
    case 'no_bid':
      return cs.tasks.errors.noBid
    case 'reason_too_long':
      return cs.tasks.errors.reasonTooLong(REASON_MAX)
    default:
      return cs.login.failed
  }
}
