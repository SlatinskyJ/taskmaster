import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

// The default week (spec §5.8): length, cutoff weekday and Prague wall time, lower/upper levels.
// Exactly one row (id 1), seeded by its migration with the defaults from the spec; the admin
// changes it on Správa (src/server/periods/defaults.ts). Every new period takes the values in
// this row at the moment it starts. Its history is the audit log (`settings.changed`).
// The checks mirror the domain's `isValidDefaults`; the UI's LEVEL_MAX lives in code only, so
// changing it needs no table rebuild. The length check's 364 is `MAX_LENGTH_DAYS`: the two move
// together, and changing it means a migration that rebuilds this table.
export const periodDefaults = sqliteTable(
  'period_defaults',
  {
    id: integer('id').primaryKey(),
    /** Whole weeks, in days (7, 14, …). */
    lengthDays: integer('length_days').notNull(),
    /** 0 = Sunday … 6 = Saturday (dates.ts `Weekday`). */
    cutoffWeekday: integer('cutoff_weekday').notNull(),
    cutoffHour: integer('cutoff_hour').notNull(),
    cutoffMinute: integer('cutoff_minute').notNull(),
    lowerLevel: integer('lower_level').notNull(),
    upperLevel: integer('upper_level').notNull(),
    /** UTC instant, ISO 8601 with milliseconds. */
    updatedAt: text('updated_at').notNull(),
    /** The admin who saved it; null for the migration's seed. */
    updatedBy: integer('updated_by').references(() => users.id),
  },
  (t) => [
    check('period_defaults_singleton_check', sql`${t.id} = 1`),
    check(
      'period_defaults_length_check',
      sql`${t.lengthDays} BETWEEN 7 AND 364 AND ${t.lengthDays} % 7 = 0`,
    ),
    check(
      'period_defaults_cutoff_check',
      sql`${t.cutoffWeekday} BETWEEN 0 AND 6 AND ${t.cutoffHour} BETWEEN 0 AND 23 AND ${t.cutoffMinute} BETWEEN 0 AND 59`,
    ),
    check(
      'period_defaults_levels_check',
      sql`${t.lowerLevel} >= 1 AND ${t.lowerLevel} <= ${t.upperLevel}`,
    ),
  ],
)

export type PeriodDefaultsRow = typeof periodDefaults.$inferSelect
