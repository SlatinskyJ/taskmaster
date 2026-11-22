import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Periods (spec §5.8): the weeks points are settled in. A period is half-open,
// [starts_at, ended_at ?? cutoff_at). Rows are written by the scheduler's periods job
// (src/server/scheduler/) at each cutoff, and by a settlement that ends the running period early. Once a period has
// started, its cutoff and levels never change; `ended_at` is the only column ever updated, once,
// from null. Never deleted. Times are UTC ISO 8601 with milliseconds, so they compare as text.
export const periods = sqliteTable(
  'periods',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    startsAt: text('starts_at').notNull(),
    /** The latest end: the default cutoff, or an agreed one (#43). */
    cutoffAt: text('cutoff_at').notNull(),
    /** When settling ended the period before its cutoff; null otherwise. */
    endedAt: text('ended_at'),
    lowerLevel: integer('lower_level').notNull(),
    upperLevel: integer('upper_level').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('periods_span_check', sql`${t.cutoffAt} > ${t.startsAt}`),
    check('periods_levels_check', sql`${t.lowerLevel} >= 1 AND ${t.lowerLevel} <= ${t.upperLevel}`),
    check(
      'periods_ended_check',
      sql`${t.endedAt} IS NULL OR (${t.endedAt} > ${t.startsAt} AND ${t.endedAt} < ${t.cutoffAt})`,
    ),
    uniqueIndex('periods_starts_at_idx').on(t.startsAt),
  ],
)

export type PeriodRow = typeof periods.$inferSelect
