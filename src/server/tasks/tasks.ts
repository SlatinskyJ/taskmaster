import { and, asc, desc, eq } from 'drizzle-orm'
import {
  approveOneTimeOffer,
  createOneTimeItem,
  createOneTimeTask,
  byPerson,
  EMPTY_BOOK,
  findPerson,
  isValidScore,
  missingRoles,
  resolveOneTime,
} from '~/domain'
import type { AgreementError, LifecycleError, OneTimeAgreement, Person } from '~/domain'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { toIsoUtc } from '~/domain/dates'
import { TASK_TITLE_MAX } from '~/lib/taskLimits'
import { writeAudit } from '~/server/audit'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { taskScoreApprovals, tasks, users } from '~/server/db/schema'
import type { TaskRow } from '~/server/db/schema'
import { listPeople } from '~/server/users/people'

// One-time tasks and their score agreement (spec §5.2 path 1, §5.5). The rules live in
// src/domain (agreement + lifecycle); this module loads the rows, asks the domain, and writes
// the result with its audit entries in one transaction. Bidding (path 2) comes with #34.

export const TITLE_MAX = TASK_TITLE_MAX

export type TaskError = AgreementError | LifecycleError | 'invalid_title' | 'not_found'

export interface NewTask {
  title: string
  score: number
  approvalRequired: boolean
}

function normaliseTitle(title: string): string | null {
  const t = title.trim().replace(/\s+/g, ' ')
  return t.length > 0 && t.length <= TITLE_MAX ? t : null
}

/** Approvals of the task's current offer, oldest first (the proposer first). */
function currentApprovers(tx: Db | Tx, task: TaskRow): number[] {
  return tx
    .select({ userId: taskScoreApprovals.userId })
    .from(taskScoreApprovals)
    .where(
      and(
        eq(taskScoreApprovals.taskId, task.id),
        eq(taskScoreApprovals.offerRound, task.offerRound),
      ),
    )
    .orderBy(asc(taskScoreApprovals.approvedAt), asc(taskScoreApprovals.userId))
    .all()
    .map((r) => r.userId)
}

/** The domain's view of a proposed task's agreement. Bids join in #34. */
function agreementOf(tx: Db | Tx, task: TaskRow): OneTimeAgreement {
  if (task.status !== 'proposed') return { status: 'open', score: task.score }
  return {
    status: 'proposed',
    offer: {
      score: task.score,
      proposedBy: task.createdBy,
      approvedBy: currentApprovers(tx, task),
    },
    book: EMPTY_BOOK,
  }
}

/** A giver creates a one-time task with an offer (spec §5.2). It starts proposed. */
export function createTask(
  db: Db,
  giverId: number,
  input: NewTask,
  now: Date = new Date(),
): Result<TaskRow, TaskError> {
  const title = normaliseTitle(input.title)
  if (!title) return fail('invalid_title')
  if (!isValidScore(input.score)) return fail('invalid_score')
  const at = toIsoUtc(now)
  return db.transaction((tx) => {
    const people = listPeople(tx)
    const giver = findPerson(people, giverId)
    if (!giver) return fail('not_a_giver')
    const agreement = createOneTimeTask(people, giverId, input.score)
    if (!agreement.ok) return agreement
    const item = createOneTimeItem(byPerson(giver), input.approvalRequired)
    if (!item.ok) return item
    // A giver's offer alone never agrees (it needs a taker), so the task starts proposed.
    const row = tx
      .insert(tasks)
      .values({
        title,
        status: agreement.value.status === 'open' ? 'open' : 'proposed',
        score: input.score,
        approvalRequired: input.approvalRequired,
        createdBy: giverId,
        createdAt: at,
        updatedAt: at,
        agreedAt: agreement.value.status === 'open' ? at : null,
      })
      .returning()
      .get()
    tx.insert(taskScoreApprovals)
      .values({
        taskId: row.id,
        userId: giverId,
        offerRound: row.offerRound,
        score: row.score,
        approvedAt: at,
      })
      .run()
    writeAudit(tx, {
      actor: { kind: 'user', userId: giverId },
      action: 'task.created',
      entityType: 'task',
      entityId: row.id,
      after: row,
      at: now,
    })
    return ok(row)
  })
}

/**
 * A party approves the task's current offer (spec §5.2 path 1). `score` is the offer the person
 * saw; a different current offer is refused, so nobody approves a number they didn't see.
 * Once a giver and a taker have approved, the task is open.
 */
export function approveTaskOffer(
  db: Db,
  userId: number,
  taskId: number,
  score: number,
  now: Date = new Date(),
): Result<TaskRow, TaskError> {
  const at = toIsoUtc(now)
  return db.transaction((tx) => {
    const task = tx.select().from(tasks).where(eq(tasks.id, taskId)).get()
    if (!task) return fail('not_found')
    if (task.status !== 'proposed') return fail('not_proposed')
    if (task.score !== score) return fail('offer_changed')
    const people = listPeople(tx)
    const result = approveOneTimeOffer(agreementOf(tx, task), people, userId)
    if (!result.ok) return result
    tx.insert(taskScoreApprovals)
      .values({ taskId, userId, offerRound: task.offerRound, score, approvedAt: at })
      .run()
    const actor = { kind: 'user', userId } as const
    writeAudit(tx, {
      actor,
      action: 'task.score_approved',
      entityType: 'task',
      entityId: taskId,
      after: { score },
      at: now,
    })
    if (result.value.status !== 'open') return ok(task)
    const opened = openTask(tx, task, now)
    writeAudit(tx, {
      actor,
      action: 'task.agreed',
      entityType: 'task',
      entityId: taskId,
      before: { status: task.status },
      after: { status: opened.status, score: opened.score },
      at: now,
    })
    return ok(opened)
  })
}

function openTask(tx: Tx, task: TaskRow, now: Date): TaskRow {
  const at = toIsoUtc(now)
  return tx
    .update(tasks)
    .set({ status: 'open', agreedAt: at, updatedAt: at })
    .where(eq(tasks.id, task.id))
    .returning()
    .get()
}

/**
 * People changed (spec §3 caller duty): approvals are counted live, so a proposed task may now
 * be agreed (e.g. a new taker). Opens those, logged as the system. Runs inside the change's
 * transaction (src/server/users/hooks.ts).
 */
export function resolveProposedTasks(tx: Tx, people: Person[], now: Date): void {
  const proposed = tx.select().from(tasks).where(eq(tasks.status, 'proposed')).all()
  for (const task of proposed) {
    const resolved = resolveOneTime(agreementOf(tx, task), people)
    if (resolved.status !== 'open') continue
    const opened = openTask(tx, task, now)
    writeAudit(tx, {
      actor: { kind: 'system' },
      action: 'task.agreed',
      entityType: 'task',
      entityId: task.id,
      before: { status: task.status },
      after: { status: opened.status, score: opened.score },
      at: now,
    })
  }
}

// ── Reads for screens ────────────────────────────────────────────────────────────────────

/** A task as a screen shows it. */
export interface TaskView {
  id: number
  title: string
  status: TaskRow['status']
  score: number
  approvalRequired: boolean
  createdByName: string
  /** Proposed only: display names of who approved the current offer, oldest first. */
  approvedBy: string[]
}

function views(db: Db | Tx, rows: TaskRow[]): TaskView[] {
  if (rows.length === 0) return []
  const names = new Map(
    db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .all()
      .map((u) => [u.id, u.name]),
  )
  return rows.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    score: t.score,
    approvalRequired: t.approvalRequired,
    createdByName: names.get(t.createdBy) ?? '',
    approvedBy:
      t.status === 'proposed' ? currentApprovers(db, t).map((id) => names.get(id) ?? '') : [],
  }))
}

/** Every one-time task, newest first (the giver's Úkoly list). */
export function listTasks(db: Db | Tx): TaskView[] {
  return views(db, db.select().from(tasks).orderBy(desc(tasks.id)).all())
}

/**
 * "Čeká na tebe" (UI doc §6): proposed tasks whose offer still needs this person's side and
 * that they haven't approved yet. Takers see every new offer; a giver only when no current
 * giver has approved (the offering giver's approval stops counting if they leave).
 */
export function pendingApprovals(db: Db | Tx, userId: number): TaskView[] {
  const people = listPeople(db)
  const me = findPerson(people, userId)
  if (!me || me.role === 'admin' || !me.active) return []
  const role = me.role
  const proposed = db
    .select()
    .from(tasks)
    .where(eq(tasks.status, 'proposed'))
    .orderBy(asc(tasks.id))
    .all()
  const waiting = proposed.filter((task) => {
    const agreement = agreementOf(db, task)
    if (agreement.status !== 'proposed') return false
    if (agreement.offer.approvedBy.includes(userId)) return false
    return missingRoles(agreement.offer, people).includes(role)
  })
  return views(db, waiting)
}
