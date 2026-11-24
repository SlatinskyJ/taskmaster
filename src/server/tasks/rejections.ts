import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import type { AuditLogRow } from '~/server/audit'
import { auditLog, tasks } from '~/server/db/schema'
import type { TaskAuditView } from './lifecycle'

// Rejected completions (spec §5.5). Rejecting sends the task back to reserved or open (a
// self-logged instance ends `rejected`), so the rejection itself lives only in its
// `task.rejected` audit entry. This read sits next to the writer (lifecycle.ts `auditView`) so
// the stored shape has one owner. Týden (#45) lists them; a dispute on a rejected completion
// (#46) names it by the entry's id (`entryId`).

export interface Rejection {
  /** The `task.rejected` audit entry's id: names this one rejection (a dispute's key, #46). */
  entryId: number
  taskId: number
  title: string
  /** The score of the rejected completion (the entry's `before`). */
  score: number
  /** Who would have earned the points (the entry's `before.earnerId`). */
  earnerId: number
  /** When it was rejected (UTC ISO). */
  at: string
  /** The giver's reason, or null without one. */
  reason: string | null
  /**
   * A rejected self-log (#38): it ends `rejected` instead of going back to the taker, so there
   * is nothing to redo.
   */
  closed: boolean
}

type Entry = Pick<AuditLogRow, 'id' | 'entityId' | 'at' | 'before' | 'after' | 'reason'>

const ENTRY = {
  id: auditLog.id,
  entityId: auditLog.entityId,
  at: auditLog.at,
  before: auditLog.before,
  after: auditLog.after,
  reason: auditLog.reason,
}

/** One stored `task.rejected` entry as a Rejection; null without an earner (nobody lost points). */
function toRejection(e: Entry, title: string): Rejection | null {
  if (e.before === null) return null
  const before = JSON.parse(e.before) as TaskAuditView
  if (before.earnerId === null) return null
  return {
    entryId: e.id,
    taskId: Number(e.entityId),
    title,
    score: before.score,
    earnerId: before.earnerId,
    at: e.at,
    reason: e.reason,
    closed: e.after !== null && (JSON.parse(e.after) as TaskAuditView).status === 'rejected',
  }
}

/** Every rejection at or after `since`, newest first. Entries with no earner are skipped. */
export function rejectionsSince(db: Db | Tx, since: Date): Rejection[] {
  const entries = db
    .select(ENTRY)
    .from(auditLog)
    .where(and(eq(auditLog.action, 'task.rejected'), gte(auditLog.at, toIsoUtc(since))))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .all()
  if (entries.length === 0) return []
  const ids = entries.map((e) => Number(e.entityId))
  const titles = new Map(
    db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(inArray(tasks.id, ids))
      .all()
      .map((t) => [t.id, t.title]),
  )
  return entries.flatMap((e) => toRejection(e, titles.get(Number(e.entityId)) ?? '') ?? [])
}

/** The rejection named by its `task.rejected` entry id (a dispute's key, #46), or null. */
export function rejectionById(db: Db | Tx, entryId: number): Rejection | null {
  const e = db
    .select(ENTRY)
    .from(auditLog)
    .where(and(eq(auditLog.id, entryId), eq(auditLog.action, 'task.rejected')))
    .get()
  if (!e) return null
  const t = db
    .select({ title: tasks.title })
    .from(tasks)
    .where(eq(tasks.id, Number(e.entityId)))
    .get()
  return toRejection(e, t?.title ?? '')
}
