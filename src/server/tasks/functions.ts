import { createServerFn } from '@tanstack/react-start'
import { requireRole } from '~/server/auth/guards'
import type { Result } from '~/domain/result'
import { TASK_SCORE_MAX } from '~/lib/taskLimits'
import { getDb } from '~/server/db'
import type { TaskRow } from '~/server/db/schema'
import type { TaskDetail, TaskError, TaskView, ThreadEntry } from './tasks'

export type { TaskDetail, TaskError, TaskView, ThreadEntry }
import type { LifecycleActionError } from './lifecycle'
import { approveTask, completeTask, rejectTask, releaseTask, reserveTask } from './lifecycle'
import { acceptLowestTaskBid, acceptOffer, counterOffer, placeBid } from './bidding'
import {
  approveTaskOffer,
  createTask,
  getTaskDetail,
  listBidsToAnswer,
  listBoard,
  listPendingCompletions,
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

function parseNewTask(data: unknown): { title: string; score: number; approvalRequired: boolean } {
  const { title, score, approvalRequired } = record(data)
  if (typeof title !== 'string' || typeof approvalRequired !== 'boolean') {
    throw new Error('Invalid input')
  }
  return { title, score: scoreOf(score), approvalRequired }
}

function parseApproval(data: unknown): { taskId: number; score: number } {
  const { taskId, score } = record(data)
  return { taskId: int(taskId), score: scoreOf(score) }
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

/** A giver's counter: the takers he saw bidding exactly that number (0 to 50). */
export function parseCounter(data: unknown): { taskId: number; score: number; bidders: number[] } {
  return { ...parseApproval(data), bidders: bidders(record(data).bidders, 0) }
}

/** What every task action returns to a screen: only ok, id and status, or the refusal. */
export function answered(result: Result<TaskRow, TaskError>): TaskActionResult {
  return result.ok ? { ok: true, id: result.value.id, status: result.value.status } : result
}

/** A giver creates a one-time task with an offer (spec §5.2). */
export const createTaskFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseNewTask)
  .handler(({ data, context }) => answered(createTask(getDb(), context.user.id, data)))

/** A giver or taker approves the offer they were shown (spec §5.2 path 1). */
export const approveTaskOfferFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseApproval)
  .handler(({ data, context }) =>
    answered(approveTaskOffer(getDb(), context.user.id, data.taskId, data.score)),
  )

/** "Čeká na tebe": offers waiting for this person's approval. */
export const listPendingApprovalsFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }): TaskView[] => pendingApprovals(getDb(), context.user.id))

/** Every one-time task, for the giver's Úkoly screen. */
export const listTasksFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver')])
  .handler((): TaskView[] => listTasks(getDb()))

// ── Bidding (#34, spec §5.2 path 2) ─────────────────────────────────────────────────────

/** A taker bids (or re-bids) a number of his own. */
export const placeBidFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('taker')])
  .validator(parseApproval)
  .handler(({ data, context }) =>
    answered(placeBid(getDb(), context.user.id, data.taskId, data.score)),
  )

/** A taker with a bid takes the offer he was shown: reserved to him. */
export const acceptOfferFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('taker')])
  .validator(parseApproval)
  .handler(({ data, context }) =>
    answered(acceptOffer(getDb(), context.user.id, data.taskId, data.score)),
  )

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

/** A task with its negotiation thread. */
export const getTaskDetailFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseTaskId)
  .handler(({ data }): TaskDetail | null => getTaskDetail(getDb(), data.taskId))

/** Proposed tasks with bids waiting for a giver. */
export const listBidsToAnswerFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver')])
  .handler((): TaskView[] => listBidsToAnswer(getDb()))

// ── Work flow (#35, spec §5.4–§5.6) ─────────────────────────────────────────────────────

export type LifecycleActionResult =
  { ok: true; id: number; status: TaskView['status'] } | { ok: false; error: LifecycleActionError }

export type { LifecycleActionError }

function parseReject(data: unknown): { taskId: number; reason?: string } {
  const { taskId, reason } = record(data)
  if (reason !== undefined && typeof reason !== 'string') throw new Error('Invalid input')
  return { taskId: int(taskId), reason }
}

function done(result: ReturnType<typeof reserveTask>): LifecycleActionResult {
  return result.ok ? { ok: true, id: result.value.id, status: result.value.status } : result
}

/** Open, reserved and pending tasks (taker's Domů until #40). */
export const listBoardFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('taker')])
  .handler((): TaskView[] => listBoard(getDb()))

/** Completions waiting for a giver (giver's Domů until #41). */
export const listPendingCompletionsFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver')])
  .handler((): TaskView[] => listPendingCompletions(getDb()))

export const reserveTaskFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('taker')])
  .validator(parseTaskId)
  .handler(({ data, context }) => done(reserveTask(getDb(), context.user.id, data.taskId)))

export const releaseTaskFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseTaskId)
  .handler(({ data, context }) => done(releaseTask(getDb(), context.user.id, data.taskId)))

/** "Hotovo" for a taker, "Hotovo bez bodů" for a giver. */
export const completeTaskFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseTaskId)
  .handler(({ data, context }) => done(completeTask(getDb(), context.user.id, data.taskId)))

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
