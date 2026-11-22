import { eq } from 'drizzle-orm'
import {
  approveCompletion,
  byPerson,
  cancelItem,
  completeItem,
  findPerson,
  rejectCompletion,
  releaseReservation,
  reserveItem,
} from '~/domain'
import type { Item, LifecycleError, Person } from '~/domain'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import type { AuditAction, Tx } from '~/server/audit'
import { REASON_MAX as REASON_LIMIT } from '~/lib/taskLimits'
import { writeAudit } from '~/server/audit'
import type { Db } from '~/server/db'
import { tasks } from '~/server/db/schema'
import type { TaskRow } from '~/server/db/schema'
import { listPeople } from '~/server/users/people'
import { saveItem, toItem } from './item'
import { discardStaleChange } from './scoreChange'
import { reopenOffer } from './tasks'

// The work flow of a one-time task (spec §5.4–§5.6): reserve, release, mark done, approve,
// reject. The lifecycle rules live in src/domain/lifecycle.ts; this module runs a step on the
// task's `Item` (./item) and saves it through `saveItem`, the one writer of a task's state, with
// its audit entry in one transaction.
// Recurring instances (#38) reuse the same domain functions with their own table.

export type LifecycleActionError = LifecycleError | 'not_found' | 'reason_too_long'

export const REASON_MAX = REASON_LIMIT

type Step = (
  item: Item,
  actor: ReturnType<typeof byPerson>,
  now: Date,
) => Result<Item, LifecycleError>

/**
 * Loads the task, runs one lifecycle step as `userId`, saves the new state and writes `action`
 * to the audit log, all in one transaction. `extra` runs after the save and before the audit
 * entry (e.g. reopening the offer of a released bid-won task), so the entry and the returned row
 * show the final state.
 */
function runStep(
  db: Db | Tx,
  userId: number,
  taskId: number,
  action: AuditAction,
  step: Step,
  now: Date,
  opts: {
    reason?: string
    /** Further writes that belong to the step, before its audit entry; returns the final row. */
    extra?: (tx: Tx, before: TaskRow, after: TaskRow, people: Person[]) => TaskRow
  } = {},
): Result<TaskRow, LifecycleActionError> {
  return db.transaction((tx) => {
    const row = tx.select().from(tasks).where(eq(tasks.id, taskId)).get()
    if (!row) return fail('not_found')
    const people = listPeople(tx)
    const person = findPerson(people, userId)
    if (!person) return fail('not_allowed')
    const next = step(toItem(row), byPerson(person), now)
    if (!next.ok) return next
    const { row: stepped, accepted, closed } = saveItem(tx, row, next.value, {}, now)
    const saved = opts.extra ? opts.extra(tx, row, stepped, people) : stepped
    const actor = { kind: 'user', userId } as const
    writeAudit(tx, {
      actor,
      action,
      entityType: 'task',
      entityId: taskId,
      before: auditView(row),
      after: { ...auditView(saved), accepted, closed },
      reason: opts.reason,
      at: now,
    })
    // A score change in flight ends once the task can't change score any more (spec §5.2);
    // logged after the step that ends it, so the history reads cause, then effect.
    discardStaleChange(tx, saved, actor, people, now)
    return ok(saved)
  })
}

/**
 * What a task's lifecycle audit entries store as `before` and `after` (read by ./rejections).
 * A stored contract: audit rows never change, so never rename or drop a key here (`score`,
 * `earnerId` are read back from old rows); only add new ones.
 */
export type TaskAuditView = ReturnType<typeof auditView>

function auditView(row: TaskRow) {
  return {
    status: row.status,
    score: row.score,
    offerRound: row.offerRound,
    agreedAt: row.agreedAt,
    reservedBy: row.reservedBy,
    reservedVia: row.reservedVia,
    reservedGiverId: row.reservedGiverId,
    completedBy: row.completedBy,
    completedAt: row.completedAt,
    earnerId: row.earnerId,
  }
}

/** A taker reserves an open task ("Rezervovat", spec §5.4). */
export function reserveTask(db: Db | Tx, userId: number, taskId: number, now: Date = new Date()) {
  return runStep(db, userId, taskId, 'task.reserved', reserveItem, now)
}

/**
 * A taker releases their own reservation, a giver anyone's (spec §5.4 [call]). A bid-won task
 * goes back to negotiation with the agreed score as the offer of the giver who agreed to it
 * (spec §5.4 [call]): that giver's approval is recorded again, a taker must approve anew.
 */
export function releaseTask(db: Db, userId: number, taskId: number, now: Date = new Date()) {
  return runStep(
    db,
    userId,
    taskId,
    'task.released',
    (item, actor) => releaseReservation(item, actor),
    now,
    {
      extra: (tx, before, after, people) =>
        after.status === 'proposed' && before.reservedGiverId !== null
          ? reopenOffer(tx, after, before.reservedGiverId, people, now)
          : after,
    },
  )
}

/**
 * Someone marks the task done ("Hotovo", spec §5.5). A taker: pending if approval is required,
 * else confirmed. A giver ("Hotovo bez bodů"): closed with no points and no approval step.
 */
export function completeTask(db: Db | Tx, userId: number, taskId: number, now: Date = new Date()) {
  return runStep(db, userId, taskId, 'task.completed', completeItem, now)
}

/** A giver approves a pending completion: the points are confirmed (spec §5.5). */
export function approveTask(db: Db | Tx, userId: number, taskId: number, now: Date = new Date()) {
  return runStep(
    db,
    userId,
    taskId,
    'task.approved',
    (item, actor) => approveCompletion(item, actor),
    now,
  )
}

/** A trimmed reason, or none when blank; `null` when too long. */
function reasonOf(reason: string | undefined): { text: string | undefined } | null {
  const text = reason?.trim() ?? ''
  if (text.length > REASON_MAX) return null
  return { text: text.length > 0 ? text : undefined }
}

/**
 * A giver cancels a task not yet completed (spec §5.6 [call]), with an optional reason that
 * everyone sees in the history. It stays a row (spec §5.10); a proposed task's thread closes.
 */
export function cancelTask(
  db: Db | Tx,
  userId: number,
  taskId: number,
  reason: string | undefined,
  now: Date = new Date(),
): Result<TaskRow, LifecycleActionError> {
  const why = reasonOf(reason)
  if (!why) return fail('reason_too_long')
  return runStep(
    db,
    userId,
    taskId,
    'task.cancelled',
    (item, actor) => cancelItem(item, actor),
    now,
    {
      reason: why.text,
    },
  )
}

/**
 * A giver rejects a pending completion with an optional reason (spec §5.5): back to the same
 * taker's reservation if it was reserved, otherwise open. The reason goes to the audit entry.
 */
export function rejectTask(
  db: Db | Tx,
  userId: number,
  taskId: number,
  reason: string | undefined,
  now: Date = new Date(),
): Result<TaskRow, LifecycleActionError> {
  const why = reasonOf(reason)
  if (!why) return fail('reason_too_long')
  return runStep(
    db,
    userId,
    taskId,
    'task.rejected',
    (item, actor) => rejectCompletion(item, actor),
    now,
    { reason: why.text },
  )
}
