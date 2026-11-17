import { eq } from 'drizzle-orm'
import {
  approveCompletion,
  byPerson,
  completeItem,
  findPerson,
  rejectCompletion,
  releaseReservation,
  reopenOneTimeOffer,
  reserveItem,
} from '~/domain'
import type { Item, LifecycleError, Person, Reservation } from '~/domain'
import { toIsoUtc, parseIsoUtc } from '~/domain/dates'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import type { AuditAction, Tx } from '~/server/audit'
import { REASON_MAX as REASON_LIMIT } from '~/lib/taskLimits'
import { writeAudit } from '~/server/audit'
import type { Db } from '~/server/db'
import { taskScoreApprovals, tasks } from '~/server/db/schema'
import type { TaskRow } from '~/server/db/schema'
import { listPeople } from '~/server/users/people'

// The work flow of a one-time task (spec §5.4–§5.6): reserve, release, mark done, approve,
// reject. The lifecycle rules live in src/domain/lifecycle.ts; this module maps a task row to
// the domain's `Item` and back, and writes the change with its audit entry in one transaction.
// Recurring instances (#38) reuse the same domain functions with their own table.

export type LifecycleActionError = LifecycleError | 'not_found' | 'reason_too_long'

export const REASON_MAX = REASON_LIMIT

/** The domain's view of a task row. Only states past agreement have lifecycle meaning here. */
export function toItem(row: TaskRow): Item {
  const base = {
    origin: 'one_time',
    approvalRequired: row.approvalRequired,
    deadline: null,
  } as const
  const reservation = reservationOf(row)
  switch (row.status) {
    case 'proposed':
    case 'open':
    case 'cancelled':
      return { ...base, status: row.status }
    case 'reserved':
      if (!reservation) throw new Error(`task ${String(row.id)} reserved without a taker`)
      return { ...base, status: 'reserved', reservation }
    case 'done_unconfirmed':
    case 'confirmed': {
      if (row.completedBy === null || row.completedAt === null) {
        throw new Error(`task ${String(row.id)} completed without completion data`)
      }
      const completion = {
        completedBy: row.completedBy,
        completedAt: parseIsoUtc(row.completedAt),
        earner: row.earnerId,
        reservation,
      }
      return { ...base, status: row.status, completion }
    }
  }
}

function reservationOf(row: TaskRow): Reservation | null {
  if (row.reservedBy === null) return null
  if (row.reservedVia === 'bid' && row.reservedGiverId !== null) {
    return { takerId: row.reservedBy, via: 'bid', giverId: row.reservedGiverId }
  }
  return { takerId: row.reservedBy, via: 'tap' }
}

/** Column values for an item's state. Reservation columns double as the completion's snapshot. */
function columnsOf(item: Item) {
  const none = {
    reservedBy: null,
    reservedVia: null,
    reservedGiverId: null,
    completedBy: null,
    completedAt: null,
    earnerId: null,
  }
  const res = (r: Reservation | null) =>
    r
      ? {
          reservedBy: r.takerId,
          reservedVia: r.via,
          reservedGiverId: r.via === 'bid' ? r.giverId : null,
        }
      : { reservedBy: null, reservedVia: null, reservedGiverId: null }
  switch (item.status) {
    case 'proposed':
    case 'open':
    case 'cancelled':
      return { status: item.status, ...none }
    case 'reserved':
      return { status: item.status, ...none, ...res(item.reservation) }
    case 'done_unconfirmed':
    case 'confirmed':
      return {
        status: item.status,
        ...res(item.completion.reservation),
        completedBy: item.completion.completedBy,
        completedAt: toIsoUtc(item.completion.completedAt),
        earnerId: item.completion.earner,
      }
    case 'expired':
    case 'rejected':
      throw new Error(`one-time tasks never become ${item.status}`)
  }
}

type Step = (
  item: Item,
  actor: ReturnType<typeof byPerson>,
  now: Date,
) => Result<Item, LifecycleError>

/**
 * Loads the task, runs one lifecycle step as `userId`, saves the new state and writes `action`
 * to the audit log, all in one transaction. `extra` runs inside the same transaction after the
 * save (e.g. reopening the offer of a released bid-won task).
 */
function runStep(
  db: Db,
  userId: number,
  taskId: number,
  action: AuditAction,
  step: Step,
  now: Date,
  opts: {
    reason?: string
    extra?: (tx: Tx, before: TaskRow, after: TaskRow, people: Person[]) => void
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
    const saved = tx
      .update(tasks)
      .set({ ...columnsOf(next.value), updatedAt: toIsoUtc(now) })
      .where(eq(tasks.id, taskId))
      .returning()
      .get()
    writeAudit(tx, {
      actor: { kind: 'user', userId },
      action,
      entityType: 'task',
      entityId: taskId,
      before: auditView(row),
      after: auditView(saved),
      reason: opts.reason,
      at: now,
    })
    opts.extra?.(tx, row, saved, people)
    return ok(saved)
  })
}

function auditView(row: TaskRow) {
  return {
    status: row.status,
    score: row.score,
    reservedBy: row.reservedBy,
    reservedVia: row.reservedVia,
    completedBy: row.completedBy,
    completedAt: row.completedAt,
    earnerId: row.earnerId,
  }
}

/** A taker reserves an open task ("Rezervovat", spec §5.4). */
export function reserveTask(db: Db, userId: number, taskId: number, now: Date = new Date()) {
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
      extra: (tx, before, after, people) => {
        if (after.status !== 'proposed' || before.reservedGiverId === null) return
        const offer = reopenOneTimeOffer(people, before.reservedGiverId, before.score)
        if (offer.status !== 'proposed') return
        // Reopening is a new offer round: approvals from the bidding don't carry over, the
        // giver who accepted the bid offers the same score again (spec §5.4).
        const offerRound = before.offerRound + 1
        tx.update(tasks).set({ offerRound, agreedAt: null }).where(eq(tasks.id, before.id)).run()
        tx.insert(taskScoreApprovals)
          .values({
            taskId: before.id,
            userId: before.reservedGiverId,
            offerRound,
            score: before.score,
            approvedAt: toIsoUtc(now),
          })
          .run()
      },
    },
  )
}

/**
 * Someone marks the task done ("Hotovo", spec §5.5). A taker: pending if approval is required,
 * else confirmed. A giver ("Udělal jsem sám"): closed with no points and no approval step.
 */
export function completeTask(db: Db, userId: number, taskId: number, now: Date = new Date()) {
  return runStep(db, userId, taskId, 'task.completed', completeItem, now)
}

/** A giver approves a pending completion: the points are confirmed (spec §5.5). */
export function approveTask(db: Db, userId: number, taskId: number, now: Date = new Date()) {
  return runStep(
    db,
    userId,
    taskId,
    'task.approved',
    (item, actor) => approveCompletion(item, actor),
    now,
  )
}

/**
 * A giver rejects a pending completion with an optional reason (spec §5.5): back to the same
 * taker's reservation if it was reserved, otherwise open. The reason goes to the audit entry.
 */
export function rejectTask(
  db: Db,
  userId: number,
  taskId: number,
  reason: string | undefined,
  now: Date = new Date(),
): Result<TaskRow, LifecycleActionError> {
  const text = reason?.trim() ?? ''
  if (text.length > REASON_MAX) return fail('reason_too_long')
  return runStep(
    db,
    userId,
    taskId,
    'task.rejected',
    (item, actor) => rejectCompletion(item, actor),
    now,
    {
      reason: text.length > 0 ? text : undefined,
    },
  )
}
