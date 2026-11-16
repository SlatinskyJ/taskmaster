import Database from 'better-sqlite3'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { applyMigrations } from './migrate.ts'

// The two checks behind `pnpm db:check` (CI job `migrations`), as functions so tests can run
// them on broken inputs. Imports use `.ts` so plain Node can load this from the script.

/**
 * Runs drizzle-kit against a temporary copy of `migrationsDir` and returns the files it would
 * add. Empty = the schema and committed migrations agree. Writes nothing in the repo.
 */
export function unmigratedSchemaChanges(migrationsDir: string, schema: string): string[] {
  const tmp = mkdtempSync(join(tmpdir(), 'tm-migrations-'))
  try {
    const copy = join(tmp, 'drizzle')
    cpSync(migrationsDir, copy, { recursive: true })
    const before = new Set(readdirSync(copy, { recursive: true }).map(String))
    // drizzle-kit prefixes `./` to --out, so hand it a path relative to the working directory.
    const out = relative(process.cwd(), copy)
    const log = execFileSync(
      'pnpm',
      ['exec', 'drizzle-kit', 'generate', '--dialect', 'sqlite', '--schema', schema, '--out', out],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const added = readdirSync(copy, { recursive: true })
      .map(String)
      .filter((f) => !before.has(f))
    // drizzle-kit can print an error and still exit 0, or write somewhere else; either way the
    // copy would look unchanged. Only a clear "no changes" counts as agreement.
    if (added.length === 0 && !log.includes('No schema changes')) {
      throw new Error(`drizzle-kit generate gave no recognisable result:\n${log}`)
    }
    return added
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** Applies every migration in `migrationsDir` to a fresh database file; throws on failure. */
export function migrationsApplyToEmptyDb(migrationsDir: string): void {
  const tmp = mkdtempSync(join(tmpdir(), 'tm-migrations-'))
  const sqlite = new Database(join(tmp, 'empty.db'))
  try {
    sqlite.pragma('foreign_keys = ON')
    applyMigrations(sqlite, migrationsDir)
  } finally {
    sqlite.close()
    rmSync(tmp, { recursive: true, force: true })
  }
}

interface Journal {
  entries: { idx: number; when: number; tag: string }[]
}

/**
 * Problems with the order of `meta/_journal.json`. Drizzle skips a migration whose `when` is
 * older than the last one applied, so a migration merged out of order (two parallel PRs) would
 * silently never run on an existing database. Empty = fine.
 */
export function journalOrderProblems(migrationsDir: string): string[] {
  const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as Journal
  const problems: string[] = []
  journal.entries.forEach((entry, i) => {
    if (entry.idx !== i) problems.push(`${entry.tag}: idx ${entry.idx}, expected ${i}`)
    const prev = journal.entries[i - 1]
    if (prev && entry.when <= prev.when) {
      problems.push(
        `${entry.tag}: timestamp ${entry.when} is not after ${prev.tag} (${prev.when}); regenerate it after rebasing`,
      )
    }
  })
  return problems
}
