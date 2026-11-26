import { and, eq, gt, inArray } from 'drizzle-orm'
import { SYSTEM, createInstance, instanceDeadline, latestSlot, slotOutcome } from '~/domain'
import { parseIsoUtc, toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { tasks, templates, templateSlots } from '~/server/db/schema'
import type { TaskRow, TemplateRow } from '~/server/db/schema'
import { expireTask } from '~/server/tasks/lifecycle'
import { deadlineRuleOf, scheduleOf } from '~/server/templates/rules'
import { insertInstance } from './instances'

// The scheduler's instances job (#39, spec §5.3 origin 1). Each tick looks at every agreed
// template with a schedule and its latest slot at or before now. `slotOutcome` (domain) decides:
// a slot already handled or before the agreement does nothing; a no-deadline slot while an
// instance is still open or reserved is skipped (no duplicates); otherwise it makes an
// instance, born at the slot. After downtime only the latest missed slot counts, and one whose
// grace has already ended is made and expired in the same tick. `template_slots` remembers the
// last handled slot, so a restart or a second tick never makes it twice.

/** Makes the instances due at `at`; returns the rows made. One template failing leaves the rest. */
export function createScheduledInstances(
  db: Db | Tx,
  at: Date,
  log: Pick<Console, 'error'> = console,
): TaskRow[] {
  const due = db
    .select()
    .from(templates)
    .where(and(eq(templates.status, 'active'), gt(templates.scheduleDays, 0)))
    .orderBy(templates.id)
    .all()
  const made: TaskRow[] = []
  for (const template of due) {
    try {
      const row = db.transaction((tx) => slotFor(tx, template, at))
      if (row) made.push(row)
    } catch (err) {
      log.error(`[scheduler] instances: template ${String(template.id)} failed`, err)
    }
  }
  return made
}

function slotFor(tx: Tx, template: TemplateRow, at: Date): TaskRow | null {
  const schedule = scheduleOf(template)
  if (!schedule || !template.agreedAt) return null
  const slot = latestSlot(schedule, at)
  const last = tx
    .select()
    .from(templateSlots)
    .where(eq(templateSlots.templateId, template.id))
    .get()
  const open = tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.templateId, template.id), inArray(tasks.status, ['open', 'reserved'])))
    .get()
  const rule = deadlineRuleOf(template)
  const outcome = slotOutcome({
    slot,
    agreedAt: parseIsoUtc(template.agreedAt),
    lastSlotAt: last ? parseIsoUtc(last.lastSlotAt) : null,
    hasOpenInstance: open !== undefined,
    deadline: rule,
  })
  if (outcome === 'none') return null
  const slotAt = toIsoUtc(slot)
  tx.insert(templateSlots)
    .values({ templateId: template.id, lastSlotAt: slotAt })
    .onConflictDoUpdate({ target: templateSlots.templateId, set: { lastSlotAt: slotAt } })
    .run()
  if (outcome === 'skip') return null
  const item = createInstance(
    SYSTEM,
    'scheduled',
    template.approvalRequired,
    rule ? instanceDeadline(rule, slot) : null,
  )
  if (!item.ok) throw new Error(`scheduled instance refused: ${item.error}`)
  const row = insertInstance(
    tx,
    { actor: { kind: 'system' }, createdBy: template.createdBy, createdAt: slot, loggedAt: at },
    template,
    'scheduled',
    item.value,
    { slotAt },
  )
  if (row.graceEndsAt === null || parseIsoUtc(row.graceEndsAt).getTime() > at.getTime()) return row
  const expired = expireTask(tx, row.id, at, false)
  if (!expired.ok) throw new Error(`expiry refused: ${expired.error}`)
  return expired.value
}
