import { createServerFn } from '@tanstack/react-start'
import { ForbiddenError, requireRole } from '~/server/auth/guards'
import type { Role } from '~/domain'
import type { Result } from '~/domain/result'
import { TASK_SCORE_MAX } from '~/lib/taskLimits'
import { getDb } from '~/server/db'
import type { TaskRow } from '~/server/db/schema'
import type { ThreadEntry } from '~/server/threadEntry'
import type { TaskDetail, TaskError, TaskView, TaskViewOpts } from './tasks'

export type { TaskDetail, TaskError, TaskView, ThreadEntry }
export type { HistoryEntry } from './history'
export type { ScoreChangeView } from './tasks'
import type { LifecycleActionError } from './lifecycle'
import {
  approveTask,
  cancelTask,
  completeTask,
  rejectTask,
  releaseTask,
  reserveTask,
} from './lifecycle'
import type { ScoreChangeError } from './scoreChange'
import {
  approveTaskScoreChange,
  declineTaskScoreChange,
  proposeTaskScoreChange,
} from './scoreChange'
import {
  acceptLowestTaskBid,
  acceptOffer,
  counterOffer,
  placeBid,
  reopenBidding,
  turnDownBids,
  withdrawBid,
} from './bidding'
import { STALE, seenOf, unseen } from '~/server/descriptions/seen'
import type { Seen as SeenText } from '~/server/descriptions/seen'
import { getFlags } from '~/server/features'
import { hasDescription, optionalDescription, seenDescriptionOf } from '~/server/descriptions/parse'
import type { Db } from '~/server/db'
import { idTopic, liveRead, serveLive } from '~/server/live'
import type { Topic } from '~/server/live'
import { templateDetailHandler } from '~/server/templates/functions'
import {
  approveTaskOffer,
  createTask,
  getTaskDetail,
  listBidsToAnswer,
  listBoard,
  listPendingCompletions,
  listScoreChangesWaiting,
  listPlanTasks,
  listTasks,
  pendingApprovals,
} from './tasks'

// Server functions for one-time tasks (#33). Roles are checked here (guards) and again by the
// domain rules inside (`not_a_giver`, `not_a_party`).

export type TaskActionResult =
  { ok: true; id: number; status: TaskView['status'] } | { ok: false; error: TaskError }

function record(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
  return data as Record<string, unknown>
}

function int(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Invalid input')
  return value
}

/** A score a person typed: a safe integer up to TASK_SCORE_MAX (the domain checks it is ≥ 1). */
function scoreOf(value: unknown): number {
  const n = int(value)
  if (n > TASK_SCORE_MAX) throw new Error('Invalid input')
  return n
}

export function parseNewTask(data: unknown): {
  title: string
  score: number
  approvalRequired: boolean
  description?: string
} {
  const body = record(data)
  const { title, score, approvalRequired } = body
  if (typeof title !== 'string' || typeof approvalRequired !== 'boolean') {
    throw new Error('Invalid input')
  }
  const description = optionalDescription(body)
  return {
    title,
    score: scoreOf(score),
    approvalRequired,
    ...(description !== undefined && { description }),
  }
}

function parseApproval(data: unknown): { taskId: number; score: number } {
  const { taskId, score } = record(data)
  return { taskId: int(taskId), score: scoreOf(score) }
}

/** A taker's yes, bid or pick: the number, and the text his page showed (#207 ruling 8). */
export function parseTakerScore(data: unknown): {
  taskId: number
  score: number
  seenDescription?: string | null
} {
  return { ...parseApproval(data), ...seenDescriptionOf(record(data)) }
}

function parseTaskId(data: unknown): { taskId: number } {
  return { taskId: int(record(data).taskId) }
}

/** The most takers a bidders list may name (the family is far smaller). */
const MAX_BIDDERS = 50

function bidders(value: unknown, min: number): number[] {
  if (!Array.isArray(value) || value.length < min || value.length > MAX_BIDDERS) {
    throw new Error('Invalid input')
  }
  const ids = value.map(int)
  if (new Set(ids).size !== ids.length) throw new Error('Invalid input')
  return ids
}

/** A giver's accept: the lowest bid he saw and every taker who held it (1 to 50). */
export function parseAcceptBid(data: unknown): {
  taskId: number
  score: number
  bidders: number[]
} {
  return { ...parseApproval(data), bidders: bidders(record(data).bidders, 1) }
}

/** A price-change answer: the task and the change the person saw. */
export function parseChangeAnswer(data: unknown): { taskId: number; changeId: number } {
  const { taskId, changeId } = record(data)
  return { taskId: int(taskId), changeId: int(changeId) }
}

/** A price-change proposal: the task and the new score. */
export const parseChangeProposal = (data: unknown) => parseApproval(data)

/** A giver's counter: the takers he saw bidding exactly that number (0 to 50). */
export function parseCounter(data: unknown): { taskId: number; score: number; bidders: number[] } {
  return { ...parseApproval(data), bidders: bidders(record(data).bidders, 0) }
}

/** A parent's turn-down: the open bids he saw, 1 to 50, one per taker. */
export function parseTurnDown(data: unknown): {
  taskId: number
  bids: { takerId: number; score: number }[]
} {
  const { taskId, bids } = record(data)
  if (!Array.isArray(bids) || bids.length < 1 || bids.length > MAX_BIDDERS) {
    throw new Error('Invalid input')
  }
  const list = bids.map((b) => {
    const { takerId, score } = record(b)
    return { takerId: int(takerId), score: scoreOf(score) }
  })
  if (new Set(list.map((b) => b.takerId)).size !== list.length) throw new Error('Invalid input')
  return { taskId: int(taskId), bids: list }
}

/** What every task action returns to a screen: only ok, id and status, or the refusal. */
export function answered(result: Result<TaskRow, TaskError>): TaskActionResult {
  return result.ok ? { ok: true, id: result.value.id, status: result.value.status } : result
}

// ── Descriptions (#207, behind the `descriptions` switch) ────────────────────────────────

interface Seen extends SeenText {
  taskId: number
  score: number
}

/**
 * The switches, as the views take them: descriptions are shown only with `descriptions` on; a
 * week copy's day only with `weekPlan` on (#257), and the lists hide later days' copies.
 */
export const shown = (db: Db, now: Date = new Date()): TaskViewOpts => {
  const flags = getFlags(db)
  return { descriptions: flags.descriptions, weekPlanAt: flags.weekPlan ? now : undefined }
}

/** A giver creates a one-time task with an offer (spec §5.2); a description needs the switch. */
export function createTaskHandler(
  db: Db,
  giverId: number,
  data: ReturnType<typeof parseNewTask>,
  now: Date,
): RefusalResult {
  if (!getFlags(db).descriptions && hasDescription(data.description)) return OFF
  return answered(createTask(db, giverId, data, now))
}

/** A giver or taker approves the offer they were shown (spec §5.2 path 1). */
export function approveTaskOfferHandler(db: Db, userId: number, data: Seen, now: Date) {
  if (unseen(db, data)) return STALE
  return answered(approveTaskOffer(db, userId, data.taskId, data.score, now, seenOf(db, data)))
}

/** A taker bids (or re-bids) a number of his own. */
export function placeBidHandler(db: Db, takerId: number, data: Seen, now: Date) {
  if (unseen(db, data)) return STALE
  return answered(placeBid(db, takerId, data.taskId, data.score, now, seenOf(db, data)))
}

/** A taker with a bid takes the offer he was shown: reserved to him. */
export function acceptOfferHandler(db: Db, takerId: number, data: Seen, now: Date) {
  if (unseen(db, data)) return STALE
  return answered(acceptOffer(db, takerId, data.taskId, data.score, now, seenOf(db, data)))
}

export const createTaskFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseNewTask)
  .handler(({ data, context }) => createTaskHandler(getDb(), context.user.id, data, new Date()))

export const approveTaskOfferFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseTakerScore)
  .handler(({ data, context }) =>
    approveTaskOfferHandler(getDb(), context.user.id, data, new Date()),
  )

// Live topics (#299, src/server/live/README.md): every task list a screen reads is `tasks`.
const TASKS: readonly Topic[] = ['tasks']

export const pendingApprovalsRead = liveRead({
  read: (db, viewer, _arg: undefined, now): TaskView[] =>
    pendingApprovals(db, viewer.id, shown(db, now)),
  topics: () => TASKS,
})

export const tasksRead = liveRead({
  read: (db, _viewer, _arg: undefined, now): TaskView[] => listTasks(db, shown(db, now)),
  topics: () => TASKS,
})

export const planTasksRead = liveRead({
  read: (db, _viewer, _arg: undefined, now): TaskView[] => listPlanTasks(db, shown(db, now)),
  topics: () => TASKS,
})

/** "Čeká na tebe": offers waiting for this person's approval. */
export const listPendingApprovalsFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }) => serveLive(pendingApprovalsRead, context.user, undefined))

/** Every one-time task, for the giver's Úkoly screen. */
export const listTasksFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver')])
  .handler(({ context }) => serveLive(tasksRead, context.user, undefined))

/** The meeting's plan step (#44). */
export const listPlanTasksFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver')])
  .handler(({ context }) => serveLive(planTasksRead, context.user, undefined))

// ── Bidding (#34, spec §5.2 path 2) ─────────────────────────────────────────────────────

export const placeBidFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('taker')])
  .validator(parseTakerScore)
  .handler(({ data, context }) => placeBidHandler(getDb(), context.user.id, data, new Date()))

export const acceptOfferFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('taker')])
  .validator(parseTakerScore)
  .handler(({ data, context }) => acceptOfferHandler(getDb(), context.user.id, data, new Date()))

/** A giver changes the offer for every taker; at takers' own bid it accepts them. */
export const counterOfferFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseCounter)
  .handler(({ data, context }) =>
    answered(counterOffer(getDb(), context.user.id, data.taskId, data.score, data.bidders)),
  )

/** A giver accepts the lowest bid he was shown. */
export const acceptLowestTaskBidFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseAcceptBid)
  .handler(({ data, context }) =>
    answered(acceptLowestTaskBid(getDb(), context.user.id, data.taskId, data.score, data.bidders)),
  )

// ── Saying no in bidding (#208, behind the `bidRefusals` switch) ─────────────────────────

export type RefusalResult = TaskActionResult | { ok: false; error: 'feature_off' }

const OFF = { ok: false, error: 'feature_off' } as const
const refusalsOn = (db: Db) => getFlags(db).bidRefusals

/** A brother's Nechci: his own open bid closes. */
export function withdrawBidHandler(
  db: Db,
  takerId: number,
  data: { taskId: number },
  now: Date,
): RefusalResult {
  if (!refusalsOn(db)) return OFF
  return answered(withdrawBid(db, takerId, data.taskId, now))
}

/** A parent turns the bidding down: every open bid he saw closes. */
export function turnDownBidsHandler(
  db: Db,
  giverId: number,
  data: { taskId: number; bids: { takerId: number; score: number }[] },
  now: Date,
): RefusalResult {
  if (!refusalsOn(db)) return OFF
  return answered(turnDownBids(db, giverId, data.taskId, data.bids, now))
}

export const withdrawBidFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('taker')])
  .validator(parseTaskId)
  .handler(({ data, context }) => withdrawBidHandler(getDb(), context.user.id, data, new Date()))

export const turnDownBidsFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseTurnDown)
  .handler(({ data, context }) => turnDownBidsHandler(getDb(), context.user.id, data, new Date()))

// ── Reopening bidding on an open task (#212, behind the `reopenBidding` switch) ───────────

const reopenOn = (db: Db) => getFlags(db).reopenBidding

/** A brother or a parent reopens bidding on an open one-time task. */
export function reopenBiddingHandler(
  db: Db,
  userId: number,
  data: { taskId: number },
  now: Date,
): RefusalResult {
  if (!reopenOn(db)) return OFF
  return answered(reopenBidding(db, userId, data.taskId, now))
}

export const reopenBiddingFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseTaskId)
  .handler(({ data, context }) => reopenBiddingHandler(getDb(), context.user.id, data, new Date()))

/**
 * A task with its negotiation thread. The admin reads it only while `disputes` is on (#222:
 * Sporné on Správa opens it); every write on the page stays giver or taker only.
 */
export function taskDetailHandler(
  db: Db,
  viewer: { id: number; role: Role },
  data: { taskId: number },
): TaskDetail | null {
  if (viewer.role === 'admin' && !getFlags(db).disputes) throw new ForbiddenError()
  return getTaskDetail(db, data.taskId, shown(db))
}

/**
 * The task page's topics: the task, and a copy's chore only when the chore page itself would
 * load for this viewer (its own visibility function, not a copy of its rule). None for null.
 */
export const taskDetailRead = liveRead({
  read: (db, viewer, arg: { taskId: number }) => taskDetailHandler(db, viewer, arg),
  topics: (viewer, data, db): Topic[] => {
    if (!data) return []
    const out: Topic[] = [idTopic('task', data.task.id)]
    const templateId = data.task.templateId
    if (templateId !== null && templateDetailHandler(db, viewer, { templateId })) {
      out.push(idTopic('template', templateId))
    }
    return out
  },
})

export const getTaskDetailFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker', 'admin')])
  .validator(parseTaskId)
  .handler(({ data, context }) => serveLive(taskDetailRead, context.user, data))

export const bidsToAnswerRead = liveRead({
  read: (db, _viewer, _arg: undefined, now): TaskView[] => listBidsToAnswer(db, shown(db, now)),
  topics: () => TASKS,
})

/** Proposed tasks with bids waiting for a giver. */
export const listBidsToAnswerFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver')])
  .handler(({ context }) => serveLive(bidsToAnswerRead, context.user, undefined))

// ── Work flow (#35, spec §5.4–§5.6) ─────────────────────────────────────────────────────

export type LifecycleActionResult =
  { ok: true; id: number; status: TaskView['status'] } | { ok: false; error: LifecycleActionError }

export type { LifecycleActionError }

export function parseReject(data: unknown): { taskId: number; reason?: string } {
  const { taskId, reason } = record(data)
  if (reason !== undefined && typeof reason !== 'string') throw new Error('Invalid input')
  return { taskId: int(taskId), reason }
}

function done(result: ReturnType<typeof reserveTask>): LifecycleActionResult {
  return result.ok ? { ok: true, id: result.value.id, status: result.value.status } : result
}

export const boardRead = liveRead({
  read: (db, _viewer, _arg: undefined, now): TaskView[] => listBoard(db, shown(db, now)),
  topics: () => TASKS,
})

export const pendingCompletionsRead = liveRead({
  read: (db, _viewer, _arg: undefined, now): TaskView[] =>
    listPendingCompletions(db, shown(db, now)),
  topics: () => TASKS,
})

/** Open, reserved and pending tasks (taker's Domů until #40). */
export const listBoardFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('taker')])
  .handler(({ context }) => serveLive(boardRead, context.user, undefined))

/** Completions waiting for a giver (giver's Domů until #41). */
export const listPendingCompletionsFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver')])
  .handler(({ context }) => serveLive(pendingCompletionsRead, context.user, undefined))

/** Rezervovat; with the `weekPlan` switch on a week copy's day rules apply (#257). */
export function reserveTaskHandler(
  db: Db,
  userId: number,
  data: { taskId: number },
  now: Date,
): LifecycleActionResult {
  return done(reserveTask(db, userId, data.taskId, now, getFlags(db).weekPlan))
}

/** Hotovo; with the `weekPlan` switch on a week copy's day rules apply (#257). */
export function completeTaskHandler(
  db: Db,
  userId: number,
  data: { taskId: number },
  now: Date,
): LifecycleActionResult {
  return done(completeTask(db, userId, data.taskId, now, getFlags(db).weekPlan))
}

export const reserveTaskFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('taker')])
  .validator(parseTaskId)
  .handler(({ data, context }) => reserveTaskHandler(getDb(), context.user.id, data, new Date()))

export const releaseTaskFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseTaskId)
  .handler(({ data, context }) => done(releaseTask(getDb(), context.user.id, data.taskId)))

/** "Hotovo" for a taker, "Hotovo bez bodů" for a giver. */
export const completeTaskFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseTaskId)
  .handler(({ data, context }) => completeTaskHandler(getDb(), context.user.id, data, new Date()))

export const approveTaskFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseTaskId)
  .handler(({ data, context }) => done(approveTask(getDb(), context.user.id, data.taskId)))

export const rejectTaskFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseReject)
  .handler(({ data, context }) =>
    done(rejectTask(getDb(), context.user.id, data.taskId, data.reason)),
  )

/** A giver cancels a task not yet completed, with an optional reason (spec §5.6 [call]). */
export const cancelTaskFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseReject)
  .handler(({ data, context }) =>
    done(cancelTask(getDb(), context.user.id, data.taskId, data.reason)),
  )

// ── Changing an agreed score (#36, spec §5.2) ───────────────────────────────────────────

export type ScoreChangeActionResult =
  { ok: true; id: number; status: TaskView['status'] } | { ok: false; error: ScoreChangeError }

export type { ScoreChangeError }

function changed(result: Result<TaskRow, ScoreChangeError>): ScoreChangeActionResult {
  return result.ok ? { ok: true, id: result.value.id, status: result.value.status } : result
}

/**
 * "Jiná cena". Open: any party; reserved: its taker or a giver. With `reopenBidding` on,
 * reopening bidding replaces it on open one-time tasks (spec §5.2 [call], #212).
 */
export function proposeTaskScoreChangeHandler(
  db: Db,
  userId: number,
  data: { taskId: number; score: number },
  now: Date,
): ScoreChangeActionResult {
  return changed(
    proposeTaskScoreChange(db, userId, data.taskId, data.score, now, { rebid: reopenOn(db) }),
  )
}

export const proposeTaskScoreChangeFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseChangeProposal)
  .handler(({ data, context }) =>
    proposeTaskScoreChangeHandler(getDb(), context.user.id, data, new Date()),
  )

export const approveTaskScoreChangeFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseChangeAnswer)
  .handler(({ data, context }) =>
    changed(approveTaskScoreChange(getDb(), context.user.id, data.taskId, data.changeId)),
  )

/** Nesouhlasím (someone it waits for) or Stáhnout návrh (the proposer). */
export const declineTaskScoreChangeFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseChangeAnswer)
  .handler(({ data, context }) =>
    changed(declineTaskScoreChange(getDb(), context.user.id, data.taskId, data.changeId)),
  )

/** "Čeká na tebe": price changes waiting for this person. */
export const scoreChangesWaitingRead = liveRead({
  read: (db, viewer, _arg: undefined, now): TaskView[] =>
    listScoreChangesWaiting(db, viewer.id, shown(db, now)),
  topics: () => TASKS,
})

export const listScoreChangesWaitingFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }) => serveLive(scoreChangesWaitingRead, context.user, undefined))
