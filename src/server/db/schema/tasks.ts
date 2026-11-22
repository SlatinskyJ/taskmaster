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
import { templates } from './templates'
import { THREAD_CLOSINGS, THREAD_SIDES } from './thread'
import { users } from './users'

export { THREAD_CLOSINGS, THREAD_SIDES }

// One-time tasks and instances of templates (spec §4, §5.2, §5.3, §5.6). The row holds the
// lifecycle state and the score: the giver's current offer while `proposed`, the agreed score
// after that (an instance's score is the template's at creation and never changes). Never
// deleted: cancelled is a state (spec §5.10). The negotiation (offers and bids) of a one-time
// task is `task_thread` below.

/**
 * The states a task can be in (spec §5.6). Expired (#39) and rejected (a self-log a giver
 * turned down) are for instances only.
 */
export const TASK_STATUSES = [
  'proposed',
  'open',
  'reserved',
  'done_unconfirmed',
  'confirmed',
  'cancelled',
  'expired',
  'rejected',
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

/**
 * Where a row came from (spec §5.3), same names as the domain's `ItemOrigin`. `scheduled` is
 * written by the scheduler (#39).
 */
export const TASK_ORIGINS = ['one_time', 'on_demand', 'self_logged', 'scheduled'] as const
export type TaskOrigin = (typeof TASK_ORIGINS)[number]

/** How a reservation was made (spec §5.2 path 2, §5.4). No CHECK: adding one needs a rebuild. */
export const RESERVATION_VIAS = ['tap', 'bid'] as const
export type ReservationVia = (typeof RESERVATION_VIAS)[number]

export const tasks = sqliteTable(
  'tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** What to do, in the family's words, e.g. "Umýt auto". */
    title: text('title').notNull(),
    status: text('status', { enum: TASK_STATUSES }).notNull(),
    /** Whole points from 1: the current offer while proposed, then the agreed score. */
    score: integer('score').notNull(),
    /**
     * Which offer `score` is: 1 for the first offer, +1 for every new one (bids, #34). Approvals
     * belong to one offer round, so an earlier offer of the same number never counts again.
     */
    offerRound: integer('offer_round').notNull().default(1),
    /** Spec §5.5: on → a completion waits for a giver's approval. */
    approvalRequired: integer('approval_required', { mode: 'boolean' }).notNull(),
    /** The giver who created it and made the first offer. */
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    /** UTC instants, ISO 8601 with milliseconds. */
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    /** When the score was agreed; null while proposed. */
    agreedAt: text('agreed_at'),
    /**
     * The reservation (spec §5.4): set while reserved, and kept through done/confirmed as the
     * reservation held at completion, so a rejected completion goes back to the same taker.
     */
    reservedBy: integer('reserved_by').references(() => users.id),
    /** `tap` = reserved by hand; `bid` = won a bid with `reservedGiverId` (#34). */
    reservedVia: text('reserved_via', { enum: RESERVATION_VIAS }),
    reservedGiverId: integer('reserved_giver_id').references(() => users.id),
    /** Completion (spec §5.5): who marked it done and when (decides the period). */
    completedBy: integer('completed_by').references(() => users.id),
    completedAt: text('completed_at'),
    /** The taker who gets the points; null when a giver did it (givers earn none). */
    earnerId: integer('earner_id').references(() => users.id),
    /** The template an instance was made from; null for a one-time task. */
    templateId: integer('template_id').references(() => templates.id),
    origin: text('origin', { enum: TASK_ORIGINS }).notNull().default('one_time'),
    /** An instance's deadline (spec §5.3): due, and the end of the grace window. Both or neither. */
    dueAt: text('due_at'),
    graceEndsAt: text('grace_ends_at'),
  },
  (t) => [
    check(
      'tasks_status_check',
      sql`${t.status} IN ('proposed', 'open', 'reserved', 'done_unconfirmed', 'confirmed', 'cancelled', 'expired', 'rejected')`,
    ),
    check(
      'tasks_origin_check',
      sql`${t.origin} IN ('one_time', 'on_demand', 'self_logged', 'scheduled') AND (${t.origin} = 'one_time') = (${t.templateId} IS NULL)`,
    ),
    check(
      'tasks_deadline_check',
      sql`(${t.dueAt} IS NULL AND ${t.graceEndsAt} IS NULL) OR (${t.dueAt} IS NOT NULL AND ${t.graceEndsAt} IS NOT NULL AND ${t.templateId} IS NOT NULL)`,
    ),
    check('tasks_score_check', sql`${t.score} >= 1`),
    check('tasks_title_check', sql`length(trim(${t.title})) > 0`),
    index('tasks_status_idx').on(t.status),
    index('tasks_template_idx').on(t.templateId),
  ],
)

export type TaskRow = typeof tasks.$inferSelect

/**
 * Who approved which offer (spec §5.2 path 1). Keyed by offer round, so approvals of an earlier
 * offer stop counting once the giver side makes a new one (#34), even if the number repeats.
 * `score` records the number that was approved. The proposer's own row is written with the
 * offer: proposing counts as approving (spec §3). Append-only.
 */
export const taskScoreApprovals = sqliteTable(
  'task_score_approvals',
  {
    taskId: integer('task_id')
      .notNull()
      .references(() => tasks.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    offerRound: integer('offer_round').notNull(),
    score: integer('score').notNull(),
    approvedAt: text('approved_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.offerRound, t.userId] })],
)

export type TaskScoreApprovalRow = typeof taskScoreApprovals.$inferSelect

/**
 * The negotiation of a one-time task (spec §5.2 path 2): giver-side offers (the first offer, a
 * counter, the re-offer after a release) and takers' bids. Rows are never deleted, so every
 * offer and bid stays in the history. While the task is proposed it has exactly one open giver
 * row, whose score equals `tasks.score` (the current offer is stored twice: only `createTask`,
 * `counterOffer` and `reopenOffer` write giver rows, each together with `tasks.score`), and at
 * most one open bid per taker.
 */
export const taskThread = sqliteTable(
  'task_thread',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskId: integer('task_id')
      .notNull()
      .references(() => tasks.id),
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
    check('task_thread_side_check', sql`${t.side} IN ('giver', 'taker')`),
    check('task_thread_score_check', sql`${t.score} >= 1`),
    check(
      'task_thread_closed_check',
      sql`(${t.closedAt} IS NULL AND ${t.closedAs} IS NULL) OR (${t.closedAt} IS NOT NULL AND ${t.closedAs} IS NOT NULL AND ${t.closedAs} IN ('replaced', 'accepted', 'closed'))`,
    ),
    uniqueIndex('task_thread_open_offer_idx')
      .on(t.taskId)
      .where(sql`closed_at IS NULL AND side = 'giver'`),
    uniqueIndex('task_thread_open_bid_idx')
      .on(t.taskId, t.userId)
      .where(sql`closed_at IS NULL AND side = 'taker'`),
    index('task_thread_task_idx').on(t.taskId),
  ],
)

export type ThreadRow = typeof taskThread.$inferSelect

/** How a score change of an agreed task closed (spec §5.2; saying no: Jakub 2026-11-21). */
export const SCORE_CHANGE_CLOSINGS = ['agreed', 'declined', 'withdrawn', 'discarded'] as const

/**
 * A proposed new score for an agreed one-time task (spec §5.2 "Changing the score…"). At most
 * one open per task; the old score stays in `tasks.score` until it closes `agreed`. Never
 * deleted: it closes as agreed, declined, withdrawn (by its proposer) or discarded (the task
 * left open/reserved). Approvals are `task_score_change_approvals`.
 */
export const taskScoreChanges = sqliteTable(
  'task_score_changes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    taskId: integer('task_id')
      .notNull()
      .references(() => tasks.id),
    score: integer('score').notNull(),
    proposedBy: integer('proposed_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    /** Null while open. */
    closedAt: text('closed_at'),
    closedAs: text('closed_as', { enum: SCORE_CHANGE_CLOSINGS }),
    /** Who closed it; null when nobody did by hand. */
    closedBy: integer('closed_by').references(() => users.id),
  },
  (t) => [
    check('task_score_changes_score_check', sql`${t.score} >= 1`),
    check(
      'task_score_changes_closed_check',
      sql`(${t.closedAt} IS NULL AND ${t.closedAs} IS NULL) OR (${t.closedAt} IS NOT NULL AND ${t.closedAs} IS NOT NULL AND ${t.closedAs} IN ('agreed', 'declined', 'withdrawn', 'discarded'))`,
    ),
    uniqueIndex('task_score_changes_open_idx')
      .on(t.taskId)
      .where(sql`closed_at IS NULL`),
    index('task_score_changes_task_idx').on(t.taskId),
  ],
)

export type TaskScoreChangeRow = typeof taskScoreChanges.$inferSelect

/** Who said yes to which score change. The proposer's row is written with it. Append-only. */
export const taskScoreChangeApprovals = sqliteTable(
  'task_score_change_approvals',
  {
    changeId: integer('change_id')
      .notNull()
      .references(() => taskScoreChanges.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    approvedAt: text('approved_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.changeId, t.userId] })],
)

export type TaskScoreChangeApprovalRow = typeof taskScoreChangeApprovals.$inferSelect
