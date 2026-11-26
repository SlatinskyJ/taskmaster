import { and, eq, isNull } from 'drizzle-orm'
import { ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { taskDescriptionRule, templateDescriptionRule } from '~/domain'
import type { DescriptionError, DescriptionRule, Person } from '~/domain'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { descriptionChanges, tasks, templates, users } from '~/server/db/schema'
import type { DescriptionChangeRow, TaskRow, TemplateRow } from '~/server/db/schema'
import { toItem } from '~/server/tasks/item'
import { listPeople } from '~/server/users/people'

// Reads of descriptions (#207): the target with its rule, and its waiting change. No writes, and
// no imports of the task or template modules, so their views can use it.

export type DescriptionTarget = { kind: 'task'; id: number } | { kind: 'template'; id: number }

export type DescriptionServerError = DescriptionError | 'not_found' | 'no_change' | 'offer_changed'

export interface WaitingDescription {
  id: number
  /** The new text; null = removing the description. */
  description: string | null
  proposedBy: number
  createdAt: string
  /** Active takers whose OK would apply it, in people order (reserved: just the reserver). */
  waitingFor: number[]
  /** Their display names, same order, for the card's "Čeká na" line. */
  waitingForNames: string[]
}

export type Loaded =
  | { kind: 'task'; row: TaskRow; rule: Result<DescriptionRule, DescriptionError> }
  | { kind: 'template'; row: TemplateRow; rule: Result<DescriptionRule, DescriptionError> }

export function load(db: Db | Tx, target: DescriptionTarget): Loaded | null {
  if (target.kind === 'task') {
    const row = db.select().from(tasks).where(eq(tasks.id, target.id)).get()
    return row ? { kind: 'task', row, rule: taskDescriptionRule(toItem(row)) } : null
  }
  const row = db.select().from(templates).where(eq(templates.id, target.id)).get()
  if (!row) return null
  const status = row.status === 'active' ? 'agreed' : 'proposed'
  return { kind: 'template', row, rule: ok(templateDescriptionRule(status)) }
}

export function openChange(
  db: Db | Tx,
  target: DescriptionTarget,
): DescriptionChangeRow | undefined {
  const column = target.kind === 'task' ? descriptionChanges.taskId : descriptionChanges.templateId
  return db
    .select()
    .from(descriptionChanges)
    .where(and(eq(column, target.id), isNull(descriptionChanges.closedAt)))
    .get()
}

function waitingFor(rule: DescriptionRule, people: readonly Person[]): number[] {
  if (rule.kind === 'direct') return []
  return people
    .filter((p) => p.active && p.role === 'taker')
    .filter((p) => rule.kind === 'any_taker' || p.id === rule.takerId)
    .map((p) => p.id)
}

/** The target's waiting change and who may OK it, or null. */
export function waitingDescriptionOf(
  db: Db | Tx,
  target: DescriptionTarget,
): WaitingDescription | null {
  const pending = openChange(db, target)
  if (!pending) return null
  const loaded = load(db, target)
  const rule = loaded?.rule
  const ids = rule?.ok ? waitingFor(rule.value, listPeople(db)) : []
  const names = new Map(
    db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .all()
      .map((u) => [u.id, u.name]),
  )
  return {
    id: pending.id,
    description: pending.description,
    proposedBy: pending.proposedBy,
    createdAt: pending.createdAt,
    waitingFor: ids,
    waitingForNames: ids.map((id) => names.get(id) ?? ''),
  }
}

/** A waiting change on Domů "Čeká na tebe" (ruling 6): the item it is on, for a page link. */
export interface DescriptionWaitingRow {
  target: DescriptionTarget
  name: string
  score: number
  changeId: number
}

/** Every open change whose OK may come from `userId`, oldest first. */
export function listDescriptionChangesWaiting(
  db: Db | Tx,
  userId: number,
): DescriptionWaitingRow[] {
  const open = db
    .select()
    .from(descriptionChanges)
    .where(isNull(descriptionChanges.closedAt))
    .orderBy(descriptionChanges.id)
    .all()
  const rows: DescriptionWaitingRow[] = []
  for (const change of open) {
    const target: DescriptionTarget =
      change.taskId !== null
        ? { kind: 'task', id: change.taskId }
        : { kind: 'template', id: change.templateId ?? 0 }
    const waiting = waitingDescriptionOf(db, target)
    const loaded = load(db, target)
    if (!waiting?.waitingFor.includes(userId) || !loaded) continue
    rows.push({ target, name: loaded.row.title, score: loaded.row.score, changeId: change.id })
  }
  return rows
}
