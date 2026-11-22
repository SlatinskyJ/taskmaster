import type { AuditAction } from '~/server/audit'
import { entityLog } from '~/server/audit'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'

// A task's history (#36, UI doc §7.2 GTask "history"), built from the audit log (spec §5.10).
// Only names, scores and reasons leave the server: never the log's `before` / `after` JSON.

export type TaskHistoryAction = Extract<
  AuditAction,
  `task.${string}` | 'instance.created' | 'instance.self_logged'
>

export interface HistoryEntry {
  id: number
  /** UTC ISO. */
  at: string
  action: TaskHistoryAction
  /** Who did it; null for the system. */
  by: { id: number; name: string } | null
  /** The score the step was about, when it names one. */
  score: number | null
  /** `task.agreed` only: who the task was reserved to by the agreement. */
  reservedBy: { id: number; name: string } | null
  reason: string | null
}

function field(after: string | null, key: string): unknown {
  if (after === null) return undefined
  const parsed: unknown = JSON.parse(after)
  return typeof parsed === 'object' && parsed !== null
    ? (parsed as Record<string, unknown>)[key]
    : undefined
}

const safeInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) ? v : null

/** The task's entries, oldest first. `name` turns a user id into a display name. */
export function taskHistory(
  db: Db | Tx,
  taskId: number,
  name: (id: number) => string,
): HistoryEntry[] {
  return entityLog(db, 'task', taskId).map((e) => {
    const reserved = e.action === 'task.agreed' ? safeInt(field(e.after, 'reservedBy')) : null
    return {
      id: e.id,
      at: e.at,
      action: e.action as TaskHistoryAction,
      by: e.actorUserId === null ? null : { id: e.actorUserId, name: name(e.actorUserId) },
      score: safeInt(field(e.after, 'score')),
      reservedBy: reserved === null ? null : { id: reserved, name: name(reserved) },
      reason: e.reason,
    }
  })
}
