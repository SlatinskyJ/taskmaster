import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { disputes } from './disputes'
import { SETTLEMENT_LEVELS, settlements } from './settlements'
import { users } from './users'

// Settlement corrections and manual point adjustments (spec §5.9, #48). The rules are the
// domain's (src/domain/settlement.ts); the store is src/server/corrections/. Both tables are
// append-only (triggers in migration 0026): a correction is a new row linked to the final
// settlement, and its point difference is a new adjustment row (`correction_id`). `dispute_id`
// names the dispute a row resolved, if any. Times are UTC ISO 8601 with milliseconds.

export const settlementCorrections = sqliteTable(
  'settlement_corrections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    settlementId: integer('settlement_id')
      .notNull()
      .references(() => settlements.id),
    /** The level the settlement should have had, for the money paid outside the app. */
    level: text('level', { enum: SETTLEMENT_LEVELS }).notNull(),
    /** That level's points in the settled period. */
    deducted: integer('deducted').notNull(),
    /** Stored trimmed, 1–1000 characters. */
    reason: text('reason').notNull(),
    disputeId: integer('dispute_id').references(() => disputes.id),
    madeBy: integer('made_by')
      .notNull()
      .references(() => users.id),
    madeAt: text('made_at').notNull(),
  },
  (t) => [
    check('settlement_corrections_level_check', sql`${t.level} IN ('none', 'lower', 'upper')`),
    check(
      'settlement_corrections_deducted_check',
      sql`${t.deducted} >= 0 AND (${t.level} = 'none') = (${t.deducted} = 0)`,
    ),
    check('settlement_corrections_reason_check', sql`length(trim(${t.reason})) BETWEEN 1 AND 1000`),
    index('settlement_corrections_settlement_idx').on(t.settlementId),
  ],
)

export const pointAdjustments = sqliteTable(
  'point_adjustments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    takerId: integer('taker_id')
      .notNull()
      .references(() => users.id),
    /** Positive adds, negative removes; never 0. */
    points: integer('points').notNull(),
    /** Stored trimmed, 1–1000 characters. */
    reason: text('reason').notNull(),
    /** The correction this difference comes from; null for a manual adjustment. */
    correctionId: integer('correction_id')
      .unique()
      .references(() => settlementCorrections.id),
    disputeId: integer('dispute_id').references(() => disputes.id),
    madeBy: integer('made_by')
      .notNull()
      .references(() => users.id),
    madeAt: text('made_at').notNull(),
  },
  (t) => [
    check('point_adjustments_points_check', sql`${t.points} <> 0`),
    check('point_adjustments_reason_check', sql`length(trim(${t.reason})) BETWEEN 1 AND 1000`),
    index('point_adjustments_taker_idx').on(t.takerId),
  ],
)

export type SettlementCorrectionRow = typeof settlementCorrections.$inferSelect
export type PointAdjustmentRow = typeof pointAdjustments.$inferSelect
