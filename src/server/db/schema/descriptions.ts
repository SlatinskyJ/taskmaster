import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { tasks } from './tasks'
import { templates } from './templates'
import { users } from './users'

/**
 * How a waiting description change closed (#207): agreed (a taker's OK), applied (the task went
 * back to proposed, Jakub 2026-11-26), declined (a taker's no), withdrawn (a giver set the text
 * in force again), replaced (a giver's newer change), discarded (the task was done or cancelled).
 */
export const DESCRIPTION_CHANGE_CLOSINGS = [
  'agreed',
  'applied',
  'declined',
  'withdrawn',
  'replaced',
  'discarded',
] as const
export type DescriptionChangeClosing = (typeof DESCRIPTION_CHANGE_CLOSINGS)[number]

/**
 * A giver's new description for an agreed one-time task or template, waiting for a taker's OK
 * (spec §5.1, §5.2). Exactly one of `taskId` / `templateId`. At most one open per target; the
 * text in force stays in `tasks.description` / `templates.description` until it closes
 * `agreed` or `applied`. Never deleted.
 */
export const descriptionChanges = sqliteTable(
  'description_changes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskId: integer('task_id').references(() => tasks.id),
    templateId: integer('template_id').references(() => templates.id),
    /** The new text; null = remove the description. */
    description: text('description'),
    proposedBy: integer('proposed_by')
      .notNull()
      .references(() => users.id),
    /** UTC instants, ISO 8601 with milliseconds. */
    createdAt: text('created_at').notNull(),
    /** Null while open. */
    closedAt: text('closed_at'),
    closedAs: text('closed_as', { enum: DESCRIPTION_CHANGE_CLOSINGS }),
    /** Who closed it; null when nobody did by hand. */
    closedBy: integer('closed_by').references(() => users.id),
  },
  (t) => [
    check(
      'description_changes_target_check',
      sql`(${t.taskId} IS NULL) <> (${t.templateId} IS NULL)`,
    ),
    check(
      'description_changes_closed_check',
      sql`(${t.closedAt} IS NULL AND ${t.closedAs} IS NULL) OR (${t.closedAt} IS NOT NULL AND ${t.closedAs} IS NOT NULL AND ${t.closedAs} IN ('agreed', 'applied', 'declined', 'withdrawn', 'replaced', 'discarded'))`,
    ),
    uniqueIndex('description_changes_open_task_idx')
      .on(t.taskId)
      .where(sql`closed_at IS NULL AND task_id IS NOT NULL`),
    uniqueIndex('description_changes_open_template_idx')
      .on(t.templateId)
      .where(sql`closed_at IS NULL AND template_id IS NOT NULL`),
    index('description_changes_task_idx').on(t.taskId),
    index('description_changes_template_idx').on(t.templateId),
  ],
)

export type DescriptionChangeRow = typeof descriptionChanges.$inferSelect
