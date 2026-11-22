import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import {
  approveOneTimeOffer,
  createOneTimeItem,
  createOneTimeTask,
  byPerson,
  findPerson,
  isValidScore,
  liveBook,
  lowestBid,
  markAgreed,
  missingRoles,
  oneTimeChangeWaitingFor,
  reopenOneTimeOffer,
  resolveOneTime,
} from '~/domain'
import type { AgreementError, LifecycleError, OneTimeAgreement, Person } from '~/domain'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { toIsoUtc } from '~/domain/dates'
import { normaliseTitle, TASK_TITLE_MAX } from '~/lib/taskLimits'
import { writeAudit } from '~/server/audit'
import type { Actor, Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { taskScoreApprovals, tasks, users } from '~/server/db/schema'
import type { TaskOrigin, TaskRow } from '~/server/db/schema'
import type { ThreadEntry } from '~/server/threadEntry'
import { listPeople } from '~/server/users/people'
import { openChangeOf } from './changeRows'
import { taskHistory } from './history'
import type { HistoryEntry } from './history'
import { saveItem, toItem } from './item'
import { addEntry, openBids, openOffer, threadOf } from './thread'

// One-time tasks and their score agreement (spec §5.2 path 1, §5.5). The rules live in
// src/domain (agreement + lifecycle); this module loads the rows, asks the domain, and writes
// the result with its audit entries in one transaction. The negotiation (offers and bids) lives
// in the task's thread (./thread); bidding actions are in ./bidding. A task's state is written
// only through `saveItem` (./item).

export const TITLE_MAX = TASK_TITLE_MAX

export type TaskError = AgreementError | LifecycleError | 'invalid_title' | 'not_found'

export interface NewTask {
  title: string
  score: number
  approvalRequired: boolean
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

/** The domain's view of a proposed task's agreement: the open offer and the open bids. */
export function agreementOf(tx: Db | Tx, task: TaskRow): OneTimeAgreement {
  if (task.status !== 'proposed') return { status: 'open', score: task.score }
  // The offer is stored twice (the task's score and its open giver row); a writer that moved
  // only one fails here instead of agreeing a score next to the wrong giver.
  const offer = openOffer(tx, task.id)
  if (offer.score !== task.score) {
    throw new Error(
      `task ${String(task.id)} offer ${String(offer.score)} ≠ score ${String(task.score)}`,
    )
  }
  return {
    status: 'proposed',
    offer: {
      score: task.score,
      proposedBy: offer.userId,
      approvedBy: currentApprovers(tx, task),
    },
    book: { bids: openBids(tx, task.id).map((b) => ({ by: b.userId, score: b.score })) },
  }
}

export type AgreedOneTime = Exclude<OneTimeAgreement, { status: 'proposed' }>

/**
 * Ends a negotiation: the task is agreed at `agreed.score`, open or reserved to the bidder with
 * the giver who agreed. The thread closes (`accepted` = the rows agreed at). An agreed score that
 * differs from the current offer starts a new offer round, so no approval sits on it. Writes
 * `task.agreed`. The caller checked the task is proposed.
 */
export function agree(
  tx: Tx,
  task: TaskRow,
  agreed: AgreedOneTime,
  accepted: readonly number[],
  actor: Actor,
  now: Date,
): TaskRow {
  const item = markAgreed(
    toItem(task),
    agreed.status === 'reserved' ? { takerId: agreed.takerId, giverId: agreed.giverId } : null,
  )
  if (!item.ok) throw new Error(`task ${String(task.id)} cannot be agreed: ${item.error}`)
  const offerRound = agreed.score === task.score ? task.offerRound : task.offerRound + 1
  const saved = saveItem(
    tx,
    task,
    item.value,
    { set: { score: agreed.score, agreedAt: toIsoUtc(now), offerRound }, accepted },
    now,
  )
  const row = saved.row
  writeAudit(tx, {
    actor,
    action: 'task.agreed',
    entityType: 'task',
    entityId: task.id,
    before: { status: task.status, score: task.score, offerRound: task.offerRound },
    after: {
      status: row.status,
      score: row.score,
      offerRound: row.offerRound,
      reservedBy: row.reservedBy,
      reservedVia: row.reservedVia,
      reservedGiverId: row.reservedGiverId,
      accepted: saved.accepted,
      closed: saved.closed,
    },
    at: now,
  })
  return row
}

/** A giver creates a one-time task with an offer (spec §5.2). It starts proposed. */
export function createTask(
  db: Db | Tx,
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
    addEntry(tx, { taskId: row.id, userId: giverId, side: 'giver', score: row.score }, now)
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
  db: Db | Tx,
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
    if (result.value.status === 'proposed') return ok(task)
    return ok(agree(tx, task, result.value, [openOffer(tx, taskId).id], actor, now))
  })
}

/**
 * A bid-won task was released back to negotiation (spec §5.4 [call]). Reopening starts a new
 * offer round: approvals from the bidding don't carry over, and the giver who accepted the bid
 * offers the agreed score again. Runs inside the release's transaction and logs the giver's
 * renewed approval as the system. Returns the task as saved.
 */
export function reopenOffer(
  tx: Tx,
  task: TaskRow,
  giverId: number,
  people: Person[],
  now: Date,
): TaskRow {
  const offer = reopenOneTimeOffer(people, giverId, task.score)
  if (offer.status !== 'proposed') return task
  const at = toIsoUtc(now)
  const offerRound = task.offerRound + 1
  const reopened = tx
    .update(tasks)
    .set({ offerRound, agreedAt: null, updatedAt: at })
    .where(eq(tasks.id, task.id))
    .returning()
    .get()
  tx.insert(taskScoreApprovals)
    .values({ taskId: task.id, userId: giverId, offerRound, score: task.score, approvedAt: at })
    .run()
  const { entry } = addEntry(
    tx,
    { taskId: task.id, userId: giverId, side: 'giver', score: task.score },
    now,
  )
  writeAudit(tx, {
    actor: { kind: 'system' },
    action: 'task.score_approved',
    entityType: 'task',
    entityId: task.id,
    after: { userId: giverId, score: task.score, offerRound, entryId: entry.id },
    at: now,
  })
  return reopened
}

/**
 * People changed (spec §3 caller duty): approvals are counted live, so a proposed task may now
 * be agreed (e.g. a new taker). Opens those at the current offer, closing any open bids, logged
 * as the system. Runs inside the change's
 * transaction (src/server/users/hooks.ts).
 */
export function resolveProposedTasks(tx: Tx, people: Person[], now: Date): void {
  const proposed = tx.select().from(tasks).where(eq(tasks.status, 'proposed')).all()
  for (const task of proposed) {
    const resolved = resolveOneTime(agreementOf(tx, task), people)
    if (resolved.status !== 'open') continue
    agree(tx, task, resolved, [openOffer(tx, task.id).id], { kind: 'system' }, now)
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
  /** Proposed only: the giver whose offer `score` is (may differ from the creator), else null. */
  offeredByName: string | null
  /** Proposed only: display names of who approved the current offer, oldest first. */
  approvedBy: string[]
  /** The ids behind `approvedBy`, same order. */
  approverIds: number[]
  /** Proposed only: current takers' open bids, lowest score first, then oldest. Else []. */
  bids: { takerId: number; name: string; score: number }[]
  /** Proposed with a bid: the lowest bid and who holds it, as a giver's accept sends it back. */
  lowest: { score: number; bidders: { id: number; name: string }[] } | null
  /** The reserving taker (also kept through completion, spec §5.5), or null. */
  reservedBy: { id: number; name: string } | null
  /** Who marked it done, and when (UTC ISO), or null. */
  completedBy: { id: number; name: string } | null
  completedAt: string | null
  /** The taker who gets the points, or null (open, or done by a giver). */
  earnerId: number | null
  /** One-time task, or an instance of template `templateId` (spec §5.3). */
  origin: TaskOrigin
  templateId: number | null
  /** An instance's deadline (UTC ISO): due, and the end of the grace window; else null. */
  dueAt: string | null
  graceEndsAt: string | null
  /**
   * Proposed only: the active people of each side that has not said yes to the current offer
   * yet (any one of them agreeing is enough). Else [].
   */
  waitingFor: { id: number; name: string }[]
  /** Open or reserved with a new score in flight (spec §5.2): who proposed, agreed, is awaited. */
  scoreChange: ScoreChangeView | null
}

export interface ScoreChangeView {
  id: number
  score: number
  proposedBy: { id: number; name: string }
  approvedBy: { id: number; name: string }[]
  /** The people whose yes would still count (and who may say no). */
  waitingFor: { id: number; name: string }[]
}

/** Display names by user id ('' for an unknown id). */
function namesOf(db: Db | Tx): (id: number) => string {
  const names = new Map(
    db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .all()
      .map((u) => [u.id, u.name]),
  )
  return (id) => names.get(id) ?? ''
}

function views(db: Db | Tx, rows: TaskRow[]): TaskView[] {
  if (rows.length === 0) return []
  const name = namesOf(db)
  const people = listPeople(db)
  return rows.map((t) => {
    const agreement = agreementOf(db, t)
    const proposed = agreement.status === 'proposed' ? agreement : null
    const book = proposed ? liveBook(proposed.book, people) : { bids: [] }
    const lowest = lowestBid(book)
    const approverIds = [...(proposed?.offer.approvedBy ?? [])]
    const missing = proposed ? missingRoles(proposed.offer, people) : []
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      score: t.score,
      approvalRequired: t.approvalRequired,
      createdByName: name(t.createdBy),
      offeredByName: proposed ? name(proposed.offer.proposedBy) : null,
      approvedBy: approverIds.map(name),
      approverIds,
      bids: [...book.bids]
        .sort((a, b) => a.score - b.score)
        .map((b) => ({ takerId: b.by, name: name(b.by), score: b.score })),
      lowest: lowest && {
        score: lowest.score,
        bidders: lowest.bidders.map((id) => ({ id, name: name(id) })),
      },
      reservedBy: t.reservedBy === null ? null : { id: t.reservedBy, name: name(t.reservedBy) },
      completedBy: t.completedBy === null ? null : { id: t.completedBy, name: name(t.completedBy) },
      completedAt: t.completedAt,
      earnerId: t.earnerId,
      origin: t.origin,
      templateId: t.templateId,
      dueAt: t.dueAt,
      graceEndsAt: t.graceEndsAt,
      waitingFor: people
        .filter((p) => p.active && missing.some((role) => role === p.role))
        .map((p) => ({ id: p.id, name: name(p.id) })),
      scoreChange: scoreChangeView(db, t, people, name),
    }
  })
}

function scoreChangeView(
  db: Db | Tx,
  task: TaskRow,
  people: Person[],
  name: (id: number) => string,
): ScoreChangeView | null {
  if (task.status !== 'open' && task.status !== 'reserved') return null
  const change = openChangeOf(db, task.id)
  if (!change) return null
  const named = (id: number) => ({ id, name: name(id) })
  return {
    id: change.id,
    score: change.score,
    proposedBy: named(change.proposedBy),
    approvedBy: change.approvedBy.map(named),
    waitingFor: oneTimeChangeWaitingFor(toItem(task), change, people).map(named),
  }
}

/**
 * "Čeká na tebe" (UI doc §7.1 TApprove, a price change): open or reserved tasks whose new score
 * waits for this person, oldest change first.
 */
export function listScoreChangesWaiting(db: Db | Tx, userId: number): TaskView[] {
  const rows = db
    .select()
    .from(tasks)
    .where(inArray(tasks.status, ['open', 'reserved']))
    .all()
  const waiting = views(db, rows).filter((t) =>
    t.scoreChange?.waitingFor.some((p) => p.id === userId),
  )
  return waiting.sort((a, b) => (a.scoreChange?.id ?? 0) - (b.scoreChange?.id ?? 0))
}

export interface TaskDetail {
  task: TaskView
  thread: ThreadEntry[]
  /** Everything that happened to the task, oldest first (#36). */
  history: HistoryEntry[]
}

/** A task with its full negotiation history (spec §5.2: every bid visible), or null. */
export function getTaskDetail(db: Db | Tx, taskId: number): TaskDetail | null {
  const row = db.select().from(tasks).where(eq(tasks.id, taskId)).get()
  if (!row) return null
  const [task] = views(db, [row])
  if (!task) return null
  const name = namesOf(db)
  const thread = threadOf(db, taskId).map((e): ThreadEntry => ({
    id: e.id,
    side: e.side,
    by: { id: e.userId, name: name(e.userId) },
    score: e.score,
    at: e.createdAt,
    state: e.closedAs ?? 'open',
  }))
  return { task, thread, history: taskHistory(db, taskId, name) }
}

/** Proposed tasks with at least one current open bid, oldest task first (a giver answers them). */
export function listBidsToAnswer(db: Db | Tx): TaskView[] {
  const proposed = db
    .select()
    .from(tasks)
    .where(eq(tasks.status, 'proposed'))
    .orderBy(asc(tasks.id))
    .all()
  return views(db, proposed).filter((t) => t.bids.length > 0)
}

/**
 * The work board (taker's Domů until #40): open tasks, and reserved or pending ones, oldest
 * first. The screen splits them into "Moje" and "Volné".
 */
export function listBoard(db: Db | Tx): TaskView[] {
  return views(
    db,
    db
      .select()
      .from(tasks)
      .where(inArray(tasks.status, ['open', 'reserved', 'done_unconfirmed']))
      .orderBy(asc(tasks.id))
      .all(),
  )
}

/** Completions waiting for a giver ("Ke schválení", spec §5.5), oldest done first. */
export function listPendingCompletions(db: Db | Tx): TaskView[] {
  return views(
    db,
    db
      .select()
      .from(tasks)
      .where(eq(tasks.status, 'done_unconfirmed'))
      .orderBy(asc(tasks.completedAt))
      .all(),
  )
}

/** The meeting's plan step (spec §5.9 step 3): tasks that still need something, newest first. */
export function listPlanTasks(db: Db | Tx): TaskView[] {
  return views(
    db,
    db
      .select()
      .from(tasks)
      .where(inArray(tasks.status, ['proposed', 'open', 'reserved']))
      .orderBy(desc(tasks.id))
      .all(),
  )
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
