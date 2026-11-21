import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Launch switches (src/lib/features.ts), one row per switch. Changed by hand in the database
// (no admin screen yet); the app reads them on every page load, so no restart is needed.
// The check keeps a hand edit to 0 or 1, so `'true'` or `2` fails loudly instead of reading as on.
export const featureFlags = sqliteTable(
  'feature_flags',
  {
    key: text('key').primaryKey(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  },
  (t) => [check('feature_flags_enabled_check', sql`${t.enabled} IN (0, 1)`)],
)
