import { eq } from 'drizzle-orm'
import {
  approveOneTimeScoreChange,
  declineOneTimeScoreChange,
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

export type ScoreChangeError = AgreementError | 'not_found' | 'no_change'

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
  db: Db,
  userId: number,
  taskId: number,
  score: number,
  now: Date = new Date(),
): Result<TaskRow, ScoreChangeError> {
  return db.transaction((tx) => {
    const loaded = load(tx, taskId)
    if (!loaded) return fail('not_found')
    const { task, people } = loaded
    const pending = openChangeOf(tx, taskId)
    const proposal = proposeOneTimeScoreChange(
      toItem(task),
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
  db: Db,
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
    const result = approveOneTimeScoreChange(toItem(task), change.value, people, userId)
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
    const { row } = saveItem(tx, task, toItem(task), { set: { score } }, now)
    closeChange(tx, changeId, 'agreed', userId, now)
    writeAudit(tx, {
      actor,
      action: 'task.score_changed',
      entityType: 'task',
      entityId: taskId,
      before: { score: task.score },
      after: { changeId, score },
      at: now,
    })
    return ok(row)
  })
}

/** The proposer withdraws the change, or someone it waits for declines it. The old score stays. */
export function declineTaskScoreChange(
  db: Db,
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
    const result = declineOneTimeScoreChange(toItem(task), change.value, people, userId)
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
  if (!change || resolveOneTimeChange(toItem(row), change, people)) return null
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
