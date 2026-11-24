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
    case 'no_offer':
      return cs.tasks.errors.offerChanged
    case 'not_agreed':
      return cs.tasks.errors.templateNotAgreed
    case 'not_proposed':
    case 'not_found':
    case 'wrong_state':
      return cs.tasks.errors.gone
    case 'reserved_by_other':
      return cs.tasks.errors.reservedByOther
    case 'not_allowed':
    case 'not_a_giver':
    case 'not_a_taker':
    case 'feature_off':
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
    case 'bidding_open':
      return cs.tasks.errors.biddingOpen
    case 'reason_too_long':
      return cs.tasks.errors.reasonTooLong(REASON_MAX)
    case 'past_grace':
      return cs.instances.errors.pastGrace
    case 'score_changed':
      return cs.instances.errors.scoreChanged
    case 'already_open':
      return cs.instances.errors.alreadyOpen
    case 'too_early':
      return cs.instances.errors.tooEarly
    default:
      return cs.login.failed
  }
}

/**
 * Czech message for a refused price change or cancel (#36). Stale screens get one-time-task
 * wording here; the rest falls back to `taskErrorMessage`.
 */
export function scoreChangeErrorMessage(error: string): string {
  switch (error) {
    case 'not_involved':
      return cs.taskPrice.errors.notInvolved
    case 'change_pending':
      return cs.taskPrice.errors.changePending
    case 'no_change':
    case 'offer_changed':
      return cs.taskPrice.errors.noChange
    case 'score_frozen':
      return cs.taskPrice.errors.scoreFrozen
    case 'not_agreed':
      return cs.taskPrice.errors.notAgreed
    case 'not_changeable':
      return cs.tasks.errors.gone
    default:
      return taskErrorMessage(error)
  }
}
