import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { applyMigrations } from './migrate'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database }

/** File name of the database inside DATA_DIR. */
export const DB_FILE_NAME = 'taskmaster.db'

/** Where the SQLite file lives: `$DATA_DIR/taskmaster.db` (`/data` in the image), `.data/` in dev. */
export function databasePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolve(env.DATA_DIR ?? '.data'), DB_FILE_NAME)
}

/**
 * Committed migrations (`drizzle/`). Read from disk at boot, so the image ships the folder
 * next to `.output` (see Dockerfile). Override with MIGRATIONS_DIR.
 */
export function migrationsFolder(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.MIGRATIONS_DIR ?? 'drizzle')
}

/**
 * Opens (and creates) a database and applies the connection settings every connection needs.
 * `:memory:` gives a throwaway database for tests.
 */
export function openDb(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const sqlite = new Database(file)
  // WAL: readers don't block the writer; one file plus -wal/-shm (spec §11).
  sqlite.pragma('journal_mode = WAL')
  // NORMAL is durable in WAL mode except for the last commits on power loss; fine for us.
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('foreign_keys = ON')
  // Wait instead of failing with SQLITE_BUSY if a backup or another connection holds a lock.
  sqlite.pragma('busy_timeout = 5000')
  return drizzle({ client: sqlite, schema })
}

/**
 * Applies every pending migration, all or nothing (see `applyMigrations`). Idempotent; drizzle
 * records applied ones in `__drizzle_migrations`.
 */
export function runMigrations(db: Db, folder: string = migrationsFolder()): void {
  applyMigrations(db.$client, folder)
}

let instance: Db | undefined

/** The app's database: opened and migrated on first use (the boot plugin calls this at start). */
export function getDb(): Db {
  if (!instance) {
    const db = openDb(databasePath())
    runMigrations(db)
    instance = db
  }
  return instance
}
