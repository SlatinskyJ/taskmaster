import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

// Recurring templates (spec §4, §5.1, §5.3). A template is a chore definition, never done
// itself; instances (#38) are made from it. Never deleted (spec §5.10).

/**
 * Stored `active` is the domain's `TemplateAgreement` status `agreed` (src/domain/agreement.ts):
 * score agreement reached, instances may be made. The server module maps between the two.
 */
export const TEMPLATE_STATUSES = ['proposed', 'active'] as const
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number]

export const templates = sqliteTable(
  'templates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** What to do, e.g. "Vynést koše". */
    title: text('title').notNull(),
    status: text('status', { enum: TEMPLATE_STATUSES }).notNull(),
    /** Whole points from 1: the proposed score while proposed, the agreed score after. */
    score: integer('score').notNull(),
    /** Spec §5.5: on → a completion waits for a giver's approval. */
    approvalRequired: integer('approval_required', { mode: 'boolean' }).notNull(),
    /** Schedule weekdays as bits: `1 << weekday` (0 = Sunday … 6 = Saturday). 0 = no schedule. */
    scheduleDays: integer('schedule_days').notNull().default(0),
    /** Prague `HH:MM` the scheduled instance appears; null = start of the day. */
    scheduleTime: text('schedule_time'),
    /** Deadline rule (spec §5.3, Jakub 2026-11-18): all three set, or all null (no deadline). */
    dueDayOffset: integer('due_day_offset'),
    /** Prague `HH:MM` on the due day. */
    dueTime: text('due_time'),
    graceMinutes: integer('grace_minutes'),
    /** The giver who created it and proposed the score. */
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    /** UTC instants, ISO 8601 with milliseconds. */
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    /** When the score was agreed; null while proposed. */
    agreedAt: text('agreed_at'),
  },
  (t) => [
    check('templates_status_check', sql`${t.status} IN ('proposed', 'active')`),
    check('templates_score_check', sql`${t.score} >= 1`),
    check('templates_title_check', sql`length(trim(${t.title})) > 0`),
    check('templates_days_check', sql`${t.scheduleDays} BETWEEN 0 AND 127`),
    check('templates_time_check', sql`${t.scheduleTime} IS NULL OR ${t.scheduleDays} > 0`),
    check(
      'templates_deadline_check',
      sql`(${t.dueDayOffset} IS NULL) = (${t.dueTime} IS NULL) AND (${t.dueTime} IS NULL) = (${t.graceMinutes} IS NULL)`,
    ),
    check('templates_offset_check', sql`${t.dueDayOffset} BETWEEN 0 AND 6`),
    check('templates_grace_check', sql`${t.graceMinutes} BETWEEN 0 AND 2880`),
    index('templates_status_idx').on(t.status),
  ],
)

export type TemplateRow = typeof templates.$inferSelect

/**
 * Who approved a proposed template's score (spec §5.1). A proposed template's score never
 * changes, so there is no offer round; score changes after agreement get their own records
 * (#138). The proposer's row is written with the template: proposing counts as approving.
 * Append-only.
 */
export const templateScoreApprovals = sqliteTable(
  'template_score_approvals',
  {
    templateId: integer('template_id')
      .notNull()
      .references(() => templates.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    score: integer('score').notNull(),
    approvedAt: text('approved_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.userId] })],
)

export type TemplateScoreApprovalRow = typeof templateScoreApprovals.$inferSelect
