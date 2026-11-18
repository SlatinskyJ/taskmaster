import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

// One-time tasks (spec §4, §5.2, §5.6). The row holds the lifecycle state and the score: the
// giver's current offer while `proposed`, the agreed score after that. Never deleted:
// cancelled is a state (spec §5.10). Bids come with #34.

/** The states a one-time task can be in (spec §5.6). Expired is for instances only. */
export const TASK_STATUSES = [
  'proposed',
  'open',
  'reserved',
  'done_unconfirmed',
  'confirmed',
  'cancelled',
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

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
  },
  (t) => [
    check(
      'tasks_status_check',
      sql`${t.status} IN ('proposed', 'open', 'reserved', 'done_unconfirmed', 'confirmed', 'cancelled')`,
    ),
    check('tasks_score_check', sql`${t.score} >= 1`),
    check('tasks_title_check', sql`length(trim(${t.title})) > 0`),
    index('tasks_status_idx').on(t.status),
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
