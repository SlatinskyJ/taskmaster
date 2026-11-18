import { cs } from './strings'
import { TASK_TITLE_MAX } from './taskLimits'

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
      return cs.tasks.errors.gone
    default:
      return cs.login.failed
  }
}
