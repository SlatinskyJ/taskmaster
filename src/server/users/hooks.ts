import { resolveProposedTasks } from '~/server/tasks/tasks'
import type { PeopleChangeHook } from './people'

/**
 * Every people-change hook, listed here statically so boot always has them: the first-admin
 * bootstrap runs at server start, before feature modules may have loaded, so a load-time
 * registry could be empty. A feature that keeps agreements in flight adds its hook to this list (spec §3):
 * - proposals and bids: re-run `resolveTemplate` / `resolveOneTime` (#33, #37);
 * - reservations of a deactivated taker: release them (#35).
 */
export const PEOPLE_CHANGE_HOOKS: readonly PeopleChangeHook[] = [
  (tx, people) => {
    resolveProposedTasks(tx, people)
  },
]
