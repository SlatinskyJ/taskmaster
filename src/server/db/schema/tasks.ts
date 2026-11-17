import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

// One-time tasks (spec §4, §5.2, §5.6). The row holds the lifecycle state and the score: the
// giver's current offer while `proposed`, the agreed score after that. Never deleted:
// cancelled is a state (spec §5.10). Reservation and completion columns come with #35,
// bids with #34.

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

export const tasks = sqliteTable(
  'tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** What to do, in the family's words, e.g. "Umýt auto". */
    title: text('title').notNull(),
    status: text('status', { enum: TASK_STATUSES }).notNull(),
    /** Whole points from 1: the current offer while proposed, then the agreed score. */
    score: integer('score').notNull(),
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
 * Who approved which offered score (spec §5.2 path 1). Keyed by score, so approvals of an
 * earlier offer stop counting when the giver side changes its offer (#34). The proposer's own
 * row is written with the offer: proposing counts as approving (spec §3). Append-only.
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
    score: integer('score').notNull(),
    approvedAt: text('approved_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.score, t.userId] })],
)

export type TaskScoreApprovalRow = typeof taskScoreApprovals.$inferSelect
