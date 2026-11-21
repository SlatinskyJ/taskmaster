import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { periods } from './periods'
import { users } from './users'

// Settlements (spec §5.9): one record per taker per settled period, written at the weekly
// meeting. Final: the database rejects every update and delete (migration
// 0015_settlements_final), so a record stays as the giver confirmed it. Only the admin corrects
// one later (#105 domain), with a correction record that links to it, never by editing it.
export const SETTLEMENT_LEVELS = ['none', 'lower', 'upper'] as const

export const settlements = sqliteTable(
  'settlements',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    periodId: integer('period_id')
      .notNull()
      .references(() => periods.id),
    takerId: integer('taker_id')
      .notNull()
      .references(() => users.id),
    /** The running total at the period's end, before this deduction. */
    totalBefore: integer('total_before').notNull(),
    level: text('level', { enum: SETTLEMENT_LEVELS }).notNull(),
    deducted: integer('deducted').notNull(),
    /** Stored, not recomputed (spec §5.9). */
    carryOver: integer('carry_over').notNull(),
    settledBy: integer('settled_by')
      .notNull()
      .references(() => users.id),
    /** UTC ISO 8601 with milliseconds. */
    settledAt: text('settled_at').notNull(),
  },
  (t) => [
    check(
      'settlements_points_check',
      sql`${t.totalBefore} >= 0 AND ${t.deducted} >= 0 AND ${t.carryOver} >= 0 AND ${t.carryOver} = ${t.totalBefore} - ${t.deducted}`,
    ),
    check('settlements_level_check', sql`${t.level} IN ('none', 'lower', 'upper')`),
    check('settlements_deducted_check', sql`(${t.level} = 'none') = (${t.deducted} = 0)`),
    uniqueIndex('settlements_period_taker_idx').on(t.periodId, t.takerId),
  ],
)

export type SettlementRow = typeof settlements.$inferSelect
