import type Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

// Shared by the server (boot) and scripts/check-migrations.ts (CI), so CI tests the exact path
// production runs. Imports only packages, so plain Node can load it from the script.

/**
 * Applies every pending migration in one transaction; if any statement fails, none apply.
 *
 * Foreign keys are switched off around it: drizzle runs all pending migrations inside one
 * transaction, where SQLite ignores the `PRAGMA foreign_keys=OFF` that drizzle-kit writes into
 * table-rebuild migrations. With them on, rebuilding a parent table (`DROP TABLE` + rename)
 * would cascade-delete or reject its child rows. `foreign_key_check` runs after the commit
 * (drizzle owns the transaction): if the migrations left a dangling reference it throws, so the
 * server refuses to boot on that database instead of running on broken data.
 */
export function applyMigrations(sqlite: Database.Database, migrationsFolder: string): void {
  const fkWasOn = sqlite.pragma('foreign_keys', { simple: true }) === 1
  sqlite.pragma('foreign_keys = OFF')
  try {
    migrate(drizzle({ client: sqlite }), { migrationsFolder })
    const violations = sqlite.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) {
      throw new Error(
        `Migrations left ${violations.length} foreign key violation(s): ${JSON.stringify(violations.slice(0, 5))}`,
      )
    }
  } finally {
    if (fkWasOn) sqlite.pragma('foreign_keys = ON')
  }
}
