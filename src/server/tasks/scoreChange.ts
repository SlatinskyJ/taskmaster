import { eq } from 'drizzle-orm'
import {
  approveOneTimeScoreChange,
  declineOneTimeScoreChange,
  oneTimeChangeGiver,
  proposeOneTimeScoreChange,
  resolveOneTimeChange,
} from '~/domain'
import type { AgreementError, Person } from '~/domain'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { writeAudit } from '~/server/audit'
import type { Actor, Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { tasks } from '~/server/db/schema'
import type { TaskRow } from '~/server/db/schema'
import { listPeople } from '~/server/users/people'
import { closeChange, insertApproval, insertChange, openChangeOf } from './changeRows'
import type { OpenChange } from './changeRows'
import { saveItem, toItem } from './item'

// Changing the score of an agreed one-time task (spec §5.2 "Changing the score…"; saying no:
// Jakub 2026-11-21). The rules are src/domain/scoreChange.ts; this module loads the task and
// its open change, asks the domain, and writes the rows with their audit entries in one
// transaction. The old score stays in `tasks.score` until a change is agreed.

export type ScoreChangeError = AgreementError | 'not_found' | 'no_change' | 'bidding_instead'

interface Loaded {
  task: TaskRow
  people: Person[]
}

function load(tx: Tx, taskId: number): Loaded | null {
  const task = tx.select().from(tasks).where(eq(tasks.id, taskId)).get()
  return task ? { task, people: listPeople(tx) } : null
}

/** The open change a screen answered, or why it no longer stands. */
function answeredChange(
  tx: Tx,
  taskId: number,
  changeId: number,
): Result<OpenChange, ScoreChangeError> {
  const change = openChangeOf(tx, taskId)
  if (!change) return fail('no_change')
  if (change.id !== changeId) return fail('offer_changed')
  return ok(change)
}

/** A party proposes a new score for an agreed task: open → any party; reserved → its taker or a giver. */
export function proposeTaskScoreChange(
  db: Db | Tx,
  userId: number,
  taskId: number,
  score: number,
  now: Date = new Date(),
  opts: { rebid?: boolean } = {},
): Result<TaskRow, ScoreChangeError> {
  return db.transaction((tx) => {
    const loaded = load(tx, taskId)
    if (!loaded) return fail('not_found')
    const { task, people } = loaded
    // A reopened round (#212) negotiates the score already.
    if (task.biddingFrom !== null) return fail('bidding_open')
    // With `reopenBidding` on, reopening bidding replaces "Jiná cena" on an open one-time task
    // (spec §5.2 [call], #212); reserved tasks keep it. Checked here, in the write's transaction.
    if (opts.rebid && task.status === 'open' && task.origin === 'one_time') {
      return fail('bidding_instead')
    }
    const pending = openChangeOf(tx, taskId)
    const proposal = proposeOneTimeScoreChange(
      toItem(task, false),
      task.score,
      pending,
      people,
      userId,
      score,
    )
    if (!proposal.ok) return proposal
    // A proposal alone is never agreed (every rule needs two people), so the score stays.
    const change = insertChange(tx, taskId, userId, score, now)
    writeAudit(tx, {
      actor: { kind: 'user', userId },
      action: 'task.score_change_proposed',
      entityType: 'task',
      entityId: taskId,
      after: { changeId: change.id, score, from: task.score },
      at: now,
    })
    return ok(task)
  })
}

/** Someone the change needs says yes; once it is agreed the task takes the new score. */
export function approveTaskScoreChange(
  db: Db | Tx,
  userId: number,
  taskId: number,
  changeId: number,
  now: Date = new Date(),
): Result<TaskRow, ScoreChangeError> {
  return db.transaction((tx) => {
    const loaded = load(tx, taskId)
    if (!loaded) return fail('not_found')
    const { task, people } = loaded
    const change = answeredChange(tx, taskId, changeId)
    if (!change.ok) return change
    const result = approveOneTimeScoreChange(toItem(task, false), change.value, people, userId)
    if (!result.ok) return result
    insertApproval(tx, changeId, userId, now)
    const actor = { kind: 'user', userId } as const
    const score = change.value.score
    writeAudit(tx, {
      actor,
      action: 'task.score_change_approved',
      entityType: 'task',
      entityId: taskId,
      after: { changeId, score },
      at: now,
    })
    if (!result.value.agreed) return ok(task)
    // A bid-won reservation names the giver whose offer it was; at the new score that is the
    // first giver who said yes to it, so a later release reopens their offer, not the old one's.
    const giverId =
      task.reservedVia === 'bid' ? oneTimeChangeGiver(result.value.change, people) : null
    const set = giverId === null ? { score } : { score, reservedGiverId: giverId }
    const { row } = saveItem(tx, task, toItem(task, false), { set }, now)
    closeChange(tx, changeId, 'agreed', userId, now)
    writeAudit(tx, {
      actor,
      action: 'task.score_changed',
      entityType: 'task',
      entityId: taskId,
      // A bid-won reservation's giver moves with the score (see above): logged both sides.
      before:
        giverId === null
          ? { score: task.score }
          : { score: task.score, reservedGiverId: task.reservedGiverId },
      after: giverId === null ? { changeId, score } : { changeId, score, reservedGiverId: giverId },
      at: now,
    })
    return ok(row)
  })
}

/** The proposer withdraws the change, or someone it waits for declines it. The old score stays. */
export function declineTaskScoreChange(
  db: Db | Tx,
  userId: number,
  taskId: number,
  changeId: number,
  now: Date = new Date(),
): Result<TaskRow, ScoreChangeError> {
  return db.transaction((tx) => {
    const loaded = load(tx, taskId)
    if (!loaded) return fail('not_found')
    const { task, people } = loaded
    const change = answeredChange(tx, taskId, changeId)
    if (!change.ok) return change
    const result = declineOneTimeScoreChange(toItem(task, false), change.value, people, userId)
    if (!result.ok) return result
    closeChange(tx, changeId, result.value, userId, now)
    writeAudit(tx, {
      actor: { kind: 'user', userId },
      action:
        result.value === 'withdrawn' ? 'task.score_change_withdrawn' : 'task.score_change_declined',
      entityType: 'task',
      entityId: taskId,
      after: { changeId, score: change.value.score },
      at: now,
    })
    return ok(task)
  })
}

/**
 * Caller duty after a lifecycle step (domain `resolveOneTimeChange`): a change still open on a
 * task that left open/reserved (done, back to negotiation, cancelled) closes as `discarded`, in
 * the step's transaction. Returns the closed change's id, or null.
 */
export function discardStaleChange(
  tx: Tx,
  row: TaskRow,
  actor: Actor,
  people: Person[],
  now: Date,
): number | null {
  const change = openChangeOf(tx, row.id)
  if (!change || resolveOneTimeChange(toItem(row, false), change, people)) return null
  closeChange(tx, change.id, 'discarded', actor.kind === 'user' ? actor.userId : null, now)
  writeAudit(tx, {
    actor,
    action: 'task.score_change_discarded',
    entityType: 'task',
    entityId: row.id,
    after: { changeId: change.id, score: change.score },
    at: now,
  })
  return change.id
}
