import { createServerFn } from '@tanstack/react-start'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import type { TaskError, TaskView } from './tasks'

export type { TaskError, TaskView }
import { approveTaskOffer, createTask, listTasks, pendingApprovals } from './tasks'

// Server functions for one-time tasks (#33). Roles are checked here (guards) and again by the
// domain rules inside (`not_a_giver`, `not_a_party`).

export type TaskActionResult = { ok: true; id: number } | { ok: false; error: TaskError }

function record(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
  return data as Record<string, unknown>
}

function int(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Invalid input')
  return value
}

function parseNewTask(data: unknown): { title: string; score: number; approvalRequired: boolean } {
  const { title, score, approvalRequired } = record(data)
  if (typeof title !== 'string' || typeof approvalRequired !== 'boolean') {
    throw new Error('Invalid input')
  }
  return { title, score: int(score), approvalRequired }
}

function parseApproval(data: unknown): { taskId: number; score: number } {
  const { taskId, score } = record(data)
  return { taskId: int(taskId), score: int(score) }
}

/** A giver creates a one-time task with an offer (spec §5.2). */
export const createTaskFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseNewTask)
  .handler(({ data, context }): TaskActionResult => {
    const result = createTask(getDb(), context.user.id, data)
    return result.ok ? { ok: true, id: result.value.id } : result
  })

/** A giver or taker approves the offer they were shown (spec §5.2 path 1). */
export const approveTaskOfferFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseApproval)
  .handler(({ data, context }): TaskActionResult => {
    const result = approveTaskOffer(getDb(), context.user.id, data.taskId, data.score)
    return result.ok ? { ok: true, id: result.value.id } : result
  })

/** "Čeká na tebe": offers waiting for this person's approval. */
export const listPendingApprovalsFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }): TaskView[] => pendingApprovals(getDb(), context.user.id))

/** Every one-time task, for the giver's Úkoly screen. */
export const listTasksFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver')])
  .handler((): TaskView[] => listTasks(getDb()))
