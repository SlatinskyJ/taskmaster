import { and, eq, inArray } from 'drizzle-orm'
import {
  byPerson,
  createInstance,
  findPerson,
  instanceDeadline,
  logChoices,
  logInstant,
  selfLog,
} from '~/domain'
import type { LogWhen } from '~/domain'
import { currentPeriod } from '~/server/periods'
import type { Item, LifecycleError } from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { writeAudit } from '~/server/audit'
import type { Actor as AuditActor, Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { tasks, templates } from '~/server/db/schema'
import type { TaskRow, TemplateRow } from '~/server/db/schema'
import { columnsOf } from '~/server/tasks/item'
import { deadlineRuleOf } from '~/server/templates/rules'
import { listPeople } from '~/server/users/people'

// Instances of an agreed template made by a person (#38, spec §5.3): a giver's "+ Teď" (on
// demand) and a taker's Zapsat (self-logged). An instance is a row of `tasks` with `origin` and
// `template_id`, so every later step is the one-time task's (src/server/tasks/lifecycle.ts).
// Title, score and approval flag are copied from the template when the row is made: a later
// price change of the template never touches it (spec §4). Scheduled instances (#39) are
// ./scheduled.ts, through the same `insertInstance`.

export type InstanceError =
  LifecycleError | 'not_found' | 'not_agreed' | 'score_changed' | 'already_open' | 'too_early'

type Origin = 'on_demand' | 'self_logged' | 'scheduled'

/** Loads the template and the acting person, and checks the template is agreed. */
function load(tx: Tx, userId: number, templateId: number) {
  const template = tx.select().from(templates).where(eq(templates.id, templateId)).get()
  if (!template) return fail('not_found' as const)
  if (template.status !== 'active') return fail('not_agreed' as const)
  const person = findPerson(listPeople(tx), userId)
  if (!person) return fail('not_allowed' as const)
  return ok({ template, actor: byPerson(person) })
}

/**
 * Who makes an instance: the audit actor, the row's `created_by`, when it is born (`created_at`)
 * and when that is written (`loggedAt`, the audit entry's time; default `createdAt`). A
 * scheduled instance is born at its slot but written at the tick, later after downtime.
 */
export interface InstanceBirth {
  actor: AuditActor
  createdBy: number
  createdAt: Date
  loggedAt?: Date
  /**
   * A week-plan copy's day (spec §5.12): the instant its Prague day starts. Set → the row is
   * marked `plan_day_at` and `week_rules` on.
   */
  planDayAt?: Date
}

/**
 * Inserts the instance row and its birth entry (`instance.created` / `instance.self_logged`).
 * `extra` adds the scheduler's `slotAt` to the entry's `after`.
 */
export function insertInstance(
  tx: Tx,
  birth: InstanceBirth,
  template: TemplateRow,
  origin: Origin,
  item: Item,
  extra: { slotAt?: string } = {},
): TaskRow {
  const now = birth.loggedAt ?? birth.createdAt
  const at = toIsoUtc(now)
  const row = tx
    .insert(tasks)
    .values({
      ...columnsOf(item),
      title: template.title,
      description: template.description,
      score: template.score,
      approvalRequired: item.approvalRequired,
      templateId: template.id,
      origin,
      dueAt: item.deadline ? toIsoUtc(item.deadline.dueAt) : null,
      graceEndsAt: item.deadline ? toIsoUtc(item.deadline.graceEndsAt) : null,
      createdBy: birth.createdBy,
      createdAt: toIsoUtc(birth.createdAt),
      updatedAt: at,
      agreedAt: template.agreedAt,
      ...(birth.planDayAt ? { planDayAt: toIsoUtc(birth.planDayAt), weekRules: true } : {}),
    })
    .returning()
    .get()
  const born = {
    templateId: template.id,
    origin,
    status: row.status,
    description: row.description,
    score: row.score,
    dueAt: row.dueAt,
    graceEndsAt: row.graceEndsAt,
    approvalRequired: row.approvalRequired,
    ...(row.planDayAt !== null ? { planDayAt: row.planDayAt } : {}),
  }
  writeAudit(tx, {
    actor: birth.actor,
    action: origin === 'self_logged' ? 'instance.self_logged' : 'instance.created',
    entityType: 'task',
    entityId: row.id,
    after:
      origin !== 'self_logged'
        ? { ...born, ...extra }
        : {
            ...born,
            completedBy: row.completedBy,
            completedAt: row.completedAt,
            earnerId: row.earnerId,
            ...extra,
          },
    at: now,
  })
  return row
}

const byUser = (userId: number, now: Date): InstanceBirth => ({
  actor: { kind: 'user', userId },
  createdBy: userId,
  createdAt: now,
})

/** "+ Teď": a giver makes an open instance now; a deadline template is due by its rule from now. */
export function createOnDemandInstance(
  db: Db | Tx,
  giverId: number,
  templateId: number,
  now: Date = new Date(),
): Result<TaskRow, InstanceError> {
  return db.transaction((tx) => {
    const loaded = load(tx, giverId, templateId)
    if (!loaded.ok) return loaded
    const { template, actor } = loaded.value
    const rule = deadlineRuleOf(template)
    const item = createInstance(
      actor,
      'on_demand',
      template.approvalRequired,
      rule ? instanceDeadline(rule, now) : null,
    )
    if (!item.ok) return item
    return ok(insertInstance(tx, byUser(giverId, now), template, 'on_demand', item.value))
  })
}

/** Whether a copy of the template is on the board, open or reserved (a pending one is not). */
function onBoard(db: Db | Tx, templateId: number): boolean {
  return (
    db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.templateId, templateId), inArray(tasks.status, ['open', 'reserved'])))
      .get() !== undefined
  )
}

/** Zapsat's "Kdy?" choices at `now`: never before the running week started. */
export function logChoicesAt(db: Db | Tx, now: Date): LogWhen[] {
  return logChoices(now, currentPeriod(db, now)?.startsAt ?? null)
}

/**
 * Zapsat: a taker logs a chore he did unprompted. `score` is the number he was shown; a price
 * agreed meanwhile is refused (`score_changed`). Always waits for a giver (spec §5.3).
 * Refused while a copy of the chore is on the board (`already_open`, Jakub 2026-11-22): he takes
 * that one instead. `when` (Jakub 2026-11-22) sets the completion time ("včera" = yesterday
 * 18:00); one before the running week is refused (`too_early`). The entry is written at `now`.
 */
export function selfLogInstance(
  db: Db | Tx,
  takerId: number,
  templateId: number,
  score: number,
  now: Date = new Date(),
  when: LogWhen = 'now',
): Result<TaskRow, InstanceError> {
  return db.transaction((tx) => {
    const loaded = load(tx, takerId, templateId)
    if (!loaded.ok) return loaded
    const { template, actor } = loaded.value
    const item = selfLog(actor, logInstant(when, now))
    if (!item.ok) return item
    if (template.score !== score) return fail('score_changed')
    if (onBoard(tx, template.id)) return fail('already_open')
    if (!logChoicesAt(tx, now).includes(when)) return fail('too_early')
    return ok(insertInstance(tx, byUser(takerId, now), template, 'self_logged', item.value))
  })
}

/** What Zapsat offers: every agreed template, by Czech title; `onBoard` ones can't be logged. */
export function listLoggableTemplates(
  db: Db | Tx,
): { id: number; title: string; score: number; onBoard: boolean }[] {
  return db
    .select({ id: templates.id, title: templates.title, score: templates.score })
    .from(templates)
    .where(eq(templates.status, 'active'))
    .all()
    .sort((a, b) => a.title.localeCompare(b.title, 'cs'))
    .map((t) => ({ ...t, onBoard: onBoard(db, t.id) }))
}
