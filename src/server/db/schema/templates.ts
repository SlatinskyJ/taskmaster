import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { THREAD_CLOSINGS, THREAD_SIDES } from './thread'
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
    /** What done means (#207); copied to each instance at creation. Null = none. */
    description: text('description'),
    status: text('status', { enum: TEMPLATE_STATUSES }).notNull(),
    /**
     * Whole points from 1: the current offer while proposed (a giver's counter moves it, #209),
     * the agreed score after.
     */
    score: integer('score').notNull(),
    /**
     * Counts the offers of a proposed template, from 1: a counter or a turn-down starts the next
     * round (#209). Approvals count only in the current round. Unchanged once agreed.
     */
    offerRound: integer('offer_round').notNull().default(1),
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
    // Upper limits (MAX_DUE_DAY_OFFSET, MAX_GRACE_MINUTES) are [call]s and live in the domain only,
    // so changing one needs no table rebuild.
    check('templates_offset_check', sql`${t.dueDayOffset} >= 0`),
    check('templates_grace_check', sql`${t.graceMinutes} >= 0`),
    index('templates_status_idx').on(t.status),
  ],
)

export type TemplateRow = typeof templates.$inferSelect

/**
 * Who approved a proposed template's offer, per offer round (spec §5.1, #209): a counter or a
 * turn-down starts a new round, and only approvals of the current round count. The proposer's
 * row is written with the template, a countering giver's with his counter: offering counts as
 * approving. Append-only: a new round adds rows, nothing is overwritten. Score changes after
 * agreement are `template_thread` below.
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
    offerRound: integer('offer_round').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.offerRound, t.userId] })],
)

export type TemplateScoreApprovalRow = typeof templateScoreApprovals.$inferSelect

/**
 * A template's bidding (spec §5.1; runs like bidding, §5.2): the giver side's offers and takers'
 * bids, first on a proposed template's first score (#209: a counter also moves `templates.score`,
 * the current offer), then on score changes of the agreed template. Same shape and closings as
 * `task_thread`. Rows are never deleted, so every offer and bid stays in the history. At most one
 * open giver row per template (the offer to every taker, whoever made it) and one open bid per
 * taker. Agreement closes every open row. On an agreed template no open rows = no change in
 * flight, and `templates.score` changes only when a change is accepted.
 */
export const templateThread = sqliteTable(
  'template_thread',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    templateId: integer('template_id')
      .notNull()
      .references(() => templates.id),
    /** Who put the number: the offering giver, or the bidding taker. */
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    side: text('side', { enum: THREAD_SIDES }).notNull(),
    score: integer('score').notNull(),
    createdAt: text('created_at').notNull(),
    /** Null while open. */
    closedAt: text('closed_at'),
    closedAs: text('closed_as', { enum: THREAD_CLOSINGS }),
  },
  (t) => [
    check('template_thread_side_check', sql`${t.side} IN ('giver', 'taker')`),
    check('template_thread_score_check', sql`${t.score} >= 1`),
    check(
      'template_thread_closed_check',
      sql`(${t.closedAt} IS NULL AND ${t.closedAs} IS NULL) OR (${t.closedAt} IS NOT NULL AND ${t.closedAs} IS NOT NULL AND ${t.closedAs} IN ('replaced', 'accepted', 'closed'))`,
    ),
    uniqueIndex('template_thread_open_offer_idx')
      .on(t.templateId)
      .where(sql`closed_at IS NULL AND side = 'giver'`),
    uniqueIndex('template_thread_open_bid_idx')
      .on(t.templateId, t.userId)
      .where(sql`closed_at IS NULL AND side = 'taker'`),
    index('template_thread_template_idx').on(t.templateId),
  ],
)

export type TemplateThreadRow = typeof templateThread.$inferSelect

/**
 * The scheduler's memory (#39): the latest schedule slot it has handled for a template, made or
 * skipped. A slot at or before it never makes an instance again, so a restart or a second tick
 * can't double one. Bookkeeping, not a state change people see: no audit entry.
 */
export const templateSlots = sqliteTable('template_slots', {
  templateId: integer('template_id')
    .primaryKey()
    .references(() => templates.id),
  /** UTC instant, ISO 8601 with milliseconds. */
  lastSlotAt: text('last_slot_at').notNull(),
})

export type TemplateSlotRow = typeof templateSlots.$inferSelect
