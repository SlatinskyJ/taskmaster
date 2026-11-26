import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import type { TaskRow } from '~/server/db/schema'
import { expireTask } from '~/server/tasks/lifecycle'
import { makeWeekCopiesWith } from './weekCopyRows'
import type { WeekCopiesOpts } from './weekCopyRows'

export { WEEK_COPIES_AHEAD_DAYS } from './weekCopyRows'
export type { WeekCopiesOpts } from './weekCopyRows'

// The week's chore copies (#257, spec §5.12) for the scheduler and the settlement: ./weekCopyRows
// makes them, and a copy already over when it is made (after downtime) is expired at once by the
// system (`instance.expired`), with the day rules on.

const expireCopy = (tx: Tx, taskId: number, at: Date): TaskRow => {
  const expired = expireTask(tx, taskId, at, true)
  if (!expired.ok) throw new Error(`expiry refused: ${expired.error}`)
  return expired.value
}

/** Makes the copies due at `at` (only `opts.templateId`'s when given); returns the rows made. */
export function makeWeekCopies(db: Db | Tx, at: Date, opts: WeekCopiesOpts = {}): TaskRow[] {
  return makeWeekCopiesWith(db, at, opts, expireCopy)
}
