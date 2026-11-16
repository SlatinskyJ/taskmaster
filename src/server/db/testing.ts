import { openDb, runMigrations } from './client'
import type { Db } from './client'

/**
 * A fresh, fully migrated in-memory database for tests. Each call is isolated.
 * Close it with `db.$client.close()` (or let the test process end).
 */
export function createTestDb(): Db {
  const db = openDb(':memory:')
  runMigrations(db)
  return db
}
