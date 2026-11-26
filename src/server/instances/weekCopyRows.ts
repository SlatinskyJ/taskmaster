import { and, eq, gt } from 'drizzle-orm'
import { SYSTEM, copyDay, createInstance, instanceDeadline, weekSlots } from '~/domain'
import { addPragueDays, parseIsoUtc, toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { templates, templateSlots } from '~/server/db/schema'
import type { TaskRow, TemplateRow } from '~/server/db/schema'
import { currentPeriod } from '~/server/periods'
import { deadlineRuleOf, scheduleOf } from '~/server/templates/rules'
import { insertInstance } from './instances'

// Week chore copies (#257, spec §5.12), made while the `weekPlan` switch is on. Every schedule
// slot of the running period, from its start up to its cutoff and at most 14 days ahead of now,
// gets its copy at once: one per slot, born open, marked with its Prague day (`plan_day_at`,
// `week_rules` on). The deadline is counted from the slot. After downtime only the latest missed
// slot is made (spec §11), and one already over is made and expired at once. `template_slots`
// remembers the last slot made, so a slot is never made twice. Callers: the scheduler's
// instances job and the settlement (the next week starts), through ./weekCopies, and a
// template's agreement, which calls this module directly: ./weekCopies imports the task
// lifecycle (to expire a copy already over), and the lifecycle imports the template modules, so
// that import here would be a cycle. A copy made at agreement is never over (its slot is at or
// after the agreement), so the agreement passes no `expire`.

/** Expires a copy that is already over when it is made (the task lifecycle's `expireTask`). */
export type ExpireCopy = (tx: Tx, taskId: number, at: Date) => TaskRow

/** How far ahead of now copies are made (spec §5.12). */
export const WEEK_COPIES_AHEAD_DAYS = 14

export interface WeekCopiesOpts {
  /** Only this template's copies (its agreement). */
  templateId?: number
  log?: Pick<Console, 'error'>
}

/**
 * Makes the copies due at `at` (only `opts.templateId`'s when given); returns the rows made.
 * One transaction per template: one failing leaves the rest, logged. A copy already over is
 * expired with `expire`; with `expire` null it is refused (that template's copies roll back).
 */
export function makeWeekCopiesWith(
  db: Db | Tx,
  at: Date,
  opts: WeekCopiesOpts,
  expire: ExpireCopy | null,
): TaskRow[] {
  const period = currentPeriod(db, at)
  if (!period) return []
  const ahead = addPragueDays(at, WEEK_COPIES_AHEAD_DAYS)
  const until = ahead.getTime() < period.cutoffAt.getTime() ? ahead : period.cutoffAt
  const chosen = db
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.status, 'active'),
        gt(templates.scheduleDays, 0),
        opts.templateId === undefined ? undefined : eq(templates.id, opts.templateId),
      ),
    )
    .orderBy(templates.id)
    .all()
  const made: TaskRow[] = []
  for (const template of chosen) {
    try {
      made.push(
        ...db.transaction((tx) => copiesFor(tx, template, period.startsAt, at, until, expire)),
      )
    } catch (err) {
      ;(opts.log ?? console).error(
        `[scheduler] week copies: template ${String(template.id)} failed`,
        err,
      )
    }
  }
  return made
}

function copiesFor(
  tx: Tx,
  template: TemplateRow,
  periodStart: Date,
  at: Date,
  until: Date,
  expire: ExpireCopy | null,
): TaskRow[] {
  const schedule = scheduleOf(template)
  if (!schedule || !template.agreedAt) return []
  const agreedAt = parseIsoUtc(template.agreedAt)
  const last = tx
    .select()
    .from(templateSlots)
    .where(eq(templateSlots.templateId, template.id))
    .get()
  const slots = weekSlots({
    schedule,
    from: agreedAt.getTime() > periodStart.getTime() ? agreedAt : periodStart,
    lastSlotAt: last ? parseIsoUtc(last.lastSlotAt) : null,
    at,
    until,
  })
  const lastSlot = slots.at(-1)
  if (!lastSlot) return []
  const rule = deadlineRuleOf(template)
  const rows = slots.map((slot) => {
    const day = copyDay(slot)
    const item = createInstance(
      SYSTEM,
      'scheduled',
      template.approvalRequired,
      rule ? instanceDeadline(rule, slot) : null,
      day,
    )
    if (!item.ok) throw new Error(`week copy refused: ${item.error}`)
    const row = insertInstance(
      tx,
      {
        actor: { kind: 'system' },
        createdBy: template.createdBy,
        // A row is never made in the future: a later slot's copy is born now (ruling 3).
        createdAt: slot.getTime() < at.getTime() ? slot : at,
        loggedAt: at,
        planDayAt: day.startsAt,
      },
      template,
      'scheduled',
      item.value,
      { slotAt: toIsoUtc(slot) },
    )
    const over = item.value.deadline ? item.value.deadline.graceEndsAt : day.endsAt
    if (over.getTime() > at.getTime()) return row
    if (!expire) throw new Error(`week copy ${String(row.id)} is over and nothing expires it`)
    return expire(tx, row.id, at)
  })
  const lastSlotAt = toIsoUtc(lastSlot)
  tx.insert(templateSlots)
    .values({ templateId: template.id, lastSlotAt })
    .onConflictDoUpdate({ target: templateSlots.templateId, set: { lastSlotAt } })
    .run()
  return rows
}
