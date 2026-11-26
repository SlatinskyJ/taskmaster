import { and, asc, desc, eq, inArray, isNotNull, or } from 'drizzle-orm'
import {
  approveOneTimeOffer,
  isAgreedOneTime,
  createOneTimeItem,
  createOneTimeTask,
  byPerson,
  findPerson,
  isStaleDescription,
  isValidScore,
  liveBook,
  lowestBid,
  markAgreed,
  markRebidAgreed,
  missingRoles,
  normaliseDescription,
  oneTimeChangeWaitingFor,
  reopenOneTimeOffer,
  resolveOneTime,
} from '~/domain'
import type {
  AgreedOneTime,
  AgreementError,
  LifecycleError,
  OneTimeAgreement,
  Person,
} from '~/domain'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { startOfPragueDay, toIsoUtc } from '~/domain/dates'
import { normaliseTitle, TASK_TITLE_MAX } from '~/lib/taskLimits'
import { entityLog, writeAudit } from '~/server/audit'
import type { Actor, Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { taskScoreApprovals, tasks, users } from '~/server/db/schema'
import type { TaskOrigin, TaskRow } from '~/server/db/schema'
import { waitingDescriptionOf } from '~/server/descriptions/rows'
import type { WaitingDescription } from '~/server/descriptions/rows'
import type { ThreadEntry } from '~/server/threadEntry'
import { listPeople } from '~/server/users/people'
import { openChangeOf } from './changeRows'
import { taskHistory } from './history'
import type { HistoryEntry } from './history'
import { saveItem, toItem } from './item'
import { addEntry, lastBids, openBids, openOffer, openOfferOrNull, threadOf } from './thread'

// One-time tasks and their score agreement (spec §5.2 path 1, §5.5). The rules live in
// src/domain (agreement + lifecycle); this module loads the rows, asks the domain, and writes
// the result with its audit entries in one transaction. The negotiation (offers and bids) lives
// in the task's thread (./thread); bidding actions are in ./bidding. A task's state is written
// only through `saveItem` (./item).

export const TITLE_MAX = TASK_TITLE_MAX

export type TaskError =
  AgreementError | LifecycleError | 'invalid_title' | 'not_found' | 'description_too_long'

export interface NewTask {
  title: string
  score: number
  approvalRequired: boolean
  /** What done means (#207); normalised, blank = none. */
  description?: string | null
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
  if (task.status === 'open' && task.biddingFrom !== null)
    return roundOf(tx, task, task.biddingFrom)
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
    lastBids: lastBids(tx, task.id).map((b) => ({ by: b.userId, score: b.score })),
  }
}

/** A reopened round (#212): the agreed score stays; the offer is a giver's counter, or nobody's. */
function roundOf(tx: Db | Tx, task: TaskRow, since: number): OneTimeAgreement {
  const counter = openOfferOrNull(tx, task.id)
  return {
    status: 'rebidding',
    score: task.score,
    offer: counter ? { score: counter.score, by: counter.userId } : { score: task.score, by: null },
    book: { bids: openBids(tx, task.id).map((b) => ({ by: b.userId, score: b.score })) },
    lastBids: lastBids(tx, task.id, since).map((b) => ({ by: b.userId, score: b.score })),
  }
}

/**
 * Ends a negotiation: the task is agreed at `agreed.score`, open or reserved to the bidder with
 * the giver who agreed. The thread closes (`accepted` = the rows agreed at). An agreed score that
 * differs from the current offer starts a new offer round, so no approval sits on it. Writes
 * `task.agreed`. The caller checked the task is proposed, or open in a reopened round (#212).
 */
export function agree(
  tx: Tx,
  task: TaskRow,
  agreed: AgreedOneTime,
  accepted: readonly number[],
  actor: Actor,
  now: Date,
): TaskRow {
  const bid =
    agreed.status === 'reserved' ? { takerId: agreed.takerId, giverId: agreed.giverId } : null
  // A reopened round (#212) agrees an open task; otherwise the task leaves `proposed`.
  const inRound = task.status === 'open'
  const item = inRound
    ? markRebidAgreed(toItem(task, false), bid)
    : markAgreed(toItem(task, false), bid)
  if (!item.ok) throw new Error(`task ${String(task.id)} cannot be agreed: ${item.error}`)
  const offerRound = agreed.score === task.score ? task.offerRound : task.offerRound + 1
  const saved = saveItem(
    tx,
    task,
    item.value,
    {
      set: { score: agreed.score, agreedAt: toIsoUtc(now), offerRound },
      accepted,
      endBidding: inRound,
    },
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
  const description = normaliseDescription(input.description ?? '')
  if (!description.ok) return description
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
        description: description.value,
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
  /** The description the person's page showed (#207 ruling 8); undefined = not checked. */
  seenDescription?: string | null,
): Result<TaskRow, TaskError> {
  const at = toIsoUtc(now)
  return db.transaction((tx) => {
    const task = tx.select().from(tasks).where(eq(tasks.id, taskId)).get()
    if (!task) return fail('not_found')
    if (isStaleDescription(task.description, seenDescription)) return fail('offer_changed')
    const people = listPeople(tx)
    const agreement = agreementOf(tx, task)
    if (agreement.status === 'rebidding') {
      // A reopened round (#212): a brother's yes to a giver's counter; no approvals rows.
      if (agreement.offer.score !== score) return fail('offer_changed')
      const result = approveOneTimeOffer(agreement, people, userId)
      if (!result.ok) return result
      if (!isAgreedOneTime(result.value)) throw new Error('a yes in a round is agreed')
      const actor = { kind: 'user', userId } as const
      writeAudit(tx, {
        actor,
        action: 'task.score_approved',
        entityType: 'task',
        entityId: taskId,
        after: { score },
        at: now,
      })
      return ok(agree(tx, task, result.value, [openOffer(tx, taskId).id], actor, now))
    }
    if (task.status !== 'proposed') return fail('not_proposed')
    if (task.score !== score) return fail('offer_changed')
    const result = approveOneTimeOffer(agreement, people, userId)
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
    if (!isAgreedOneTime(result.value)) return ok(task)
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
  /** What done means (#207); null = none, or the `descriptions` switch is off. */
  description: string | null
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
  /**
   * Proposed, or open in a reopened round (#212): current takers' open bids, lowest score first,
   * then oldest. Else [].
   */
  bids: { takerId: number; name: string; score: number }[]
  /**
   * Proposed or in a round, with a bid: the lowest bid and who holds it, as a giver's accept
   * sends it back.
   */
  lowest: { score: number; bidders: { id: number; name: string }[] } | null
  /**
   * Proposed or in a round: each taker's previous bid in this round (open or withdrawn), the number he may
   * not send again until the giver side changes the offer (Jakub 2026-11-24). Else [].
   */
  lastBids: { takerId: number; score: number }[]
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
  /** When it was made (UTC ISO): an on-demand instance shows it (#38). */
  createdAt: string
  /**
   * Proposed only: the active people of each side that has not said yes to the current offer
   * yet (any one of them agreeing is enough). Else [].
   */
  waitingFor: { id: number; name: string }[]
  /** Open or reserved with a new score in flight (spec §5.2): who proposed, agreed, is awaited. */
  scoreChange: ScoreChangeView | null
  /**
   * Open in a reopened round (#212): the round's current offer (the agreed score until a parent
   * counters, by nobody) and who countered. `score` stays the agreed score. Else null.
   */
  rebidding: { offer: number; offeredBy: { id: number; name: string } | null } | null
  /**
   * A week copy's day (#257, spec §5.12): the UTC instant its Prague day starts, while the
   * `weekPlan` switch is on and its day rules apply. Else null.
   */
  planDay: string | null
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

/** What a read shows (#207): descriptions only with the `descriptions` switch on. Off by default. */
export interface TaskViewOpts {
  descriptions?: boolean
  /**
   * The `weekPlan` switch on (#257): now. Views carry a copy's day, and the lists hide a copy
   * whose day is later than today's.
   */
  weekPlanAt?: Date
}

/** A week copy under the day rules whose day is after today's (`weekPlanAt`'s). */
function laterCopy(row: TaskRow, weekPlanAt: Date | undefined): boolean {
  if (!weekPlanAt || !row.weekRules || row.planDayAt === null) return false
  return row.planDayAt > toIsoUtc(startOfPragueDay(weekPlanAt))
}

function views(db: Db | Tx, rows: TaskRow[], opts: TaskViewOpts = {}): TaskView[] {
  if (rows.length === 0) return []
  const name = namesOf(db)
  const people = listPeople(db)
  return rows.map((t) => {
    const agreement = agreementOf(db, t)
    const proposed = agreement.status === 'proposed' ? agreement : null
    const round = agreement.status === 'rebidding' ? agreement : null
    const bidding = proposed ?? round
    const book = bidding ? liveBook(bidding.book, people) : { bids: [] }
    const lowest = lowestBid(book)
    const approverIds = [...(proposed?.offer.approvedBy ?? [])]
    const missing = proposed ? missingRoles(proposed.offer, people) : []
    return {
      id: t.id,
      title: t.title,
      description: opts.descriptions ? t.description : null,
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
      lastBids: (bidding?.lastBids ?? []).map((b) => ({ takerId: b.by, score: b.score })),
      reservedBy: t.reservedBy === null ? null : { id: t.reservedBy, name: name(t.reservedBy) },
      completedBy: t.completedBy === null ? null : { id: t.completedBy, name: name(t.completedBy) },
      completedAt: t.completedAt,
      earnerId: t.earnerId,
      origin: t.origin,
      templateId: t.templateId,
      dueAt: t.dueAt,
      graceEndsAt: t.graceEndsAt,
      createdAt: t.createdAt,
      waitingFor: people
        .filter((p) => p.active && missing.some((role) => role === p.role))
        .map((p) => ({ id: p.id, name: name(p.id) })),
      scoreChange: scoreChangeView(db, t, people, name),
      rebidding: round && {
        offer: round.offer.score,
        offeredBy:
          round.offer.by === null ? null : { id: round.offer.by, name: name(round.offer.by) },
      },
      planDay: opts.weekPlanAt && t.weekRules ? t.planDayAt : null,
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
    waitingFor: oneTimeChangeWaitingFor(toItem(task, false), change, people).map(named),
  }
}

/**
 * "Čeká na tebe" (UI doc §7.1 TApprove, a price change): open or reserved tasks whose new score
 * waits for this person, oldest change first.
 */
export function listScoreChangesWaiting(
  db: Db | Tx,
  userId: number,
  opts: TaskViewOpts = {},
): TaskView[] {
  const rows = db
    .select()
    .from(tasks)
    .where(inArray(tasks.status, ['open', 'reserved']))
    .all()
  const waiting = views(db, rows, opts).filter((t) =>
    t.scoreChange?.waitingFor.some((p) => p.id === userId),
  )
  return waiting.sort((a, b) => (a.scoreChange?.id ?? 0) - (b.scoreChange?.id ?? 0))
}

export interface TaskDetail {
  task: TaskView
  thread: ThreadEntry[]
  /** Everything that happened to the task, oldest first (#36). */
  history: HistoryEntry[]
  /** A description change waiting for a taker (#207); null with none, or the switch off. */
  descriptionChange: WaitingDescription | null
}

/** A task with its full negotiation history (spec §5.2: every bid visible), or null. */
export function getTaskDetail(
  db: Db | Tx,
  taskId: number,
  opts: TaskViewOpts = {},
): TaskDetail | null {
  const row = db.select().from(tasks).where(eq(tasks.id, taskId)).get()
  if (!row) return null
  const [task] = views(db, [row], opts)
  if (!task) return null
  const name = namesOf(db)
  const from = threadFrom(db, row)
  const thread = threadOf(db, taskId)
    .filter((e) => e.id > from)
    .map((e): ThreadEntry => ({
      id: e.id,
      side: e.side,
      by: { id: e.userId, name: name(e.userId) },
      score: e.score,
      at: e.createdAt,
      state: e.closedAs ?? 'open',
    }))
  const descriptionChange = opts.descriptions
    ? waitingDescriptionOf(db, { kind: 'task', id: taskId })
    : null
  return { task, thread, history: taskHistory(db, taskId, name), descriptionChange }
}

/**
 * The thread rows a task page shows (spec §5.2: earlier rounds are not shown): those after the
 * running round's marker, else after the newest reopen's marker (`task.bidding_reopened`
 * `after.biddingFrom`, also once that round ended), else all.
 */
function threadFrom(db: Db | Tx, task: TaskRow): number {
  if (task.biddingFrom !== null) return task.biddingFrom
  const reopens = entityLog(db, 'task', task.id).filter((e) => e.action === 'task.bidding_reopened')
  const newest = reopens.at(-1)
  if (!newest?.after) return 0
  const after: unknown = JSON.parse(newest.after)
  const from =
    typeof after === 'object' && after !== null
      ? (after as Record<string, unknown>).biddingFrom
      : undefined
  return typeof from === 'number' && Number.isSafeInteger(from) ? from : 0
}

/**
 * Proposed tasks, and open ones in a reopened round (#212), with at least one current open bid,
 * oldest task first (a giver answers them).
 */
export function listBidsToAnswer(db: Db | Tx, opts: TaskViewOpts = {}): TaskView[] {
  const proposed = db
    .select()
    .from(tasks)
    .where(
      or(eq(tasks.status, 'proposed'), and(eq(tasks.status, 'open'), isNotNull(tasks.biddingFrom))),
    )
    .orderBy(asc(tasks.id))
    .all()
  return views(db, proposed, opts).filter((t) => t.bids.length > 0)
}

/**
 * The work board (taker's Domů until #40): open tasks, and reserved or pending ones, oldest
 * first. The screen splits them into "Moje" and "Volné". With the week plan on (#257) a later
 * day's copy is listed only once someone reserved it.
 */
export function listBoard(db: Db | Tx, opts: TaskViewOpts = {}): TaskView[] {
  return views(
    db,
    db
      .select()
      .from(tasks)
      .where(inArray(tasks.status, ['open', 'reserved', 'done_unconfirmed']))
      .orderBy(asc(tasks.id))
      .all()
      .filter((t) => t.status === 'reserved' || !laterCopy(t, opts.weekPlanAt)),
    opts,
  )
}

/** Completions waiting for a giver ("Ke schválení", spec §5.5), oldest done first. */
export function listPendingCompletions(db: Db | Tx, opts: TaskViewOpts = {}): TaskView[] {
  return views(
    db,
    db
      .select()
      .from(tasks)
      .where(eq(tasks.status, 'done_unconfirmed'))
      .orderBy(asc(tasks.completedAt))
      .all(),
    opts,
  )
}

/**
 * The meeting's plan step (spec §5.9 step 3): tasks that still need something, newest first.
 * With the week plan on (#257) not a later day's copy.
 */
export function listPlanTasks(db: Db | Tx, opts: TaskViewOpts = {}): TaskView[] {
  return views(
    db,
    db
      .select()
      .from(tasks)
      .where(inArray(tasks.status, ['proposed', 'open', 'reserved']))
      .orderBy(desc(tasks.id))
      .all()
      .filter((t) => !laterCopy(t, opts.weekPlanAt)),
    opts,
  )
}

/**
 * Every one-time task, newest first (the giver's Úkoly list). With the week plan on (#257) not a
 * later day's copy.
 */
export function listTasks(db: Db | Tx, opts: TaskViewOpts = {}): TaskView[] {
  return views(
    db,
    db
      .select()
      .from(tasks)
      .orderBy(desc(tasks.id))
      .all()
      .filter((t) => !laterCopy(t, opts.weekPlanAt)),
    opts,
  )
}

/**
 * "Čeká na tebe" (UI doc §6): proposed tasks whose offer still needs this person's side and
 * that they haven't approved yet. Takers see every new offer; a giver only when no current
 * giver has approved (the offering giver's approval stops counting if they leave). A reopened
 * round (#212) with a parent's counter waits for each brother until one says yes (#237), like a
 * Návrh counter does.
 */
export function pendingApprovals(db: Db | Tx, userId: number, opts: TaskViewOpts = {}): TaskView[] {
  const people = listPeople(db)
  const me = findPerson(people, userId)
  if (!me || me.role === 'admin' || !me.active) return []
  const role = me.role
  // Open tasks too: a reopened round with a parent's counter waits for every brother (#237).
  const candidates = db
    .select()
    .from(tasks)
    .where(
      or(eq(tasks.status, 'proposed'), and(eq(tasks.status, 'open'), isNotNull(tasks.biddingFrom))),
    )
    .orderBy(asc(tasks.id))
    .all()
  const waiting = candidates.filter((task) => {
    const agreement = agreementOf(db, task)
    if (agreement.status === 'rebidding') return role === 'taker' && agreement.offer.by !== null
    if (agreement.status !== 'proposed') return false
    if (agreement.offer.approvedBy.includes(userId)) return false
    return missingRoles(agreement.offer, people).includes(role)
  })
  return views(db, waiting, opts)
}
