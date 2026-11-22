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
import { periods } from './periods'
import { users } from './users'

// Proposals (spec §5.8): a different cutoff/levels for the period after a running one, and new
// default-week settings. The rules are the domain's (src/domain/periods.ts); the store is
// src/server/periods/proposals.ts. Rows are never deleted: `status` moves from pending to one
// closed state once. Approvals are their own rows (proposing counts as approving). Times are UTC
// ISO 8601 with milliseconds. The partial unique indexes back up "one open proposal at a time".

const PERIOD_STATUSES = sql`('pending', 'agreed', 'rejected', 'withdrawn', 'lapsed')`
// A defaults proposal never lapses ([call] spec §5.8).
const DEFAULTS_STATUSES = sql`('pending', 'agreed', 'rejected', 'withdrawn')`

export const periodProposals = sqliteTable(
  'period_proposals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** The running period this one follows; the change is for the period after it. */
    afterPeriodId: integer('after_period_id')
      .notNull()
      .references(() => periods.id),
    cutoffAt: text('cutoff_at').notNull(),
    lowerLevel: integer('lower_level').notNull(),
    upperLevel: integer('upper_level').notNull(),
    proposedBy: integer('proposed_by')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull(),
    /** Who rejected or withdrew it; null otherwise (a lapse has no person). */
    closedBy: integer('closed_by').references(() => users.id),
    createdAt: text('created_at').notNull(),
    closedAt: text('closed_at'),
  },
  (t) => [
    check('period_proposals_status_check', sql`${t.status} IN ${PERIOD_STATUSES}`),
    check(
      'period_proposals_levels_check',
      sql`${t.lowerLevel} >= 1 AND ${t.lowerLevel} <= ${t.upperLevel}`,
    ),
    uniqueIndex('period_proposals_open_idx')
      .on(t.afterPeriodId)
      .where(sql`${t.status} IN ('pending', 'agreed')`),
  ],
)

export const defaultsProposals = sqliteTable(
  'defaults_proposals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    lengthDays: integer('length_days').notNull(),
    cutoffWeekday: integer('cutoff_weekday').notNull(),
    cutoffHour: integer('cutoff_hour').notNull(),
    cutoffMinute: integer('cutoff_minute').notNull(),
    lowerLevel: integer('lower_level').notNull(),
    upperLevel: integer('upper_level').notNull(),
    proposedBy: integer('proposed_by')
      .notNull()
      .references(() => users.id),
    status: text('status').notNull(),
    closedBy: integer('closed_by').references(() => users.id),
    createdAt: text('created_at').notNull(),
    closedAt: text('closed_at'),
  },
  (t) => [
    check('defaults_proposals_status_check', sql`${t.status} IN ${DEFAULTS_STATUSES}`),
    // Same rules as period_defaults (364 = MAX_LENGTH_DAYS; they move together).
    check(
      'defaults_proposals_length_check',
      sql`${t.lengthDays} BETWEEN 7 AND 364 AND ${t.lengthDays} % 7 = 0`,
    ),
    check(
      'defaults_proposals_cutoff_check',
      sql`${t.cutoffWeekday} BETWEEN 0 AND 6 AND ${t.cutoffHour} BETWEEN 0 AND 23 AND ${t.cutoffMinute} BETWEEN 0 AND 59`,
    ),
    check(
      'defaults_proposals_levels_check',
      sql`${t.lowerLevel} >= 1 AND ${t.lowerLevel} <= ${t.upperLevel}`,
    ),
    uniqueIndex('defaults_proposals_pending_idx')
      .on(t.status)
      .where(sql`${t.status} = 'pending'`),
  ],
)

export const periodProposalApprovals = sqliteTable(
  'period_proposal_approvals',
  {
    proposalId: integer('proposal_id')
      .notNull()
      .references(() => periodProposals.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    approvedAt: text('approved_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.proposalId, t.userId] }), index('ppa_user_idx').on(t.userId)],
)

export const defaultsProposalApprovals = sqliteTable(
  'defaults_proposal_approvals',
  {
    proposalId: integer('proposal_id')
      .notNull()
      .references(() => defaultsProposals.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    approvedAt: text('approved_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.proposalId, t.userId] }), index('dpa_user_idx').on(t.userId)],
)

export type PeriodProposalRow = typeof periodProposals.$inferSelect
export type DefaultsProposalRow = typeof defaultsProposals.$inferSelect
