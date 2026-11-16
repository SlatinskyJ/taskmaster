// CI migration check (#16). Fails when:
//  1. the Drizzle schema has changes that no committed migration covers, or
//  2. the committed migrations don't apply cleanly to an empty database.
// Run locally with `pnpm db:check`. Writes nothing inside the repo.
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const MIGRATIONS = 'drizzle'
const SCHEMA = './src/server/db/schema'

const tmp = mkdtempSync(join(tmpdir(), 'tm-migrations-'))
let failed = false
try {
  // 1. Generate into a copy of the committed folder; any new file means a missing migration.
  const copy = join(tmp, 'drizzle')
  cpSync(MIGRATIONS, copy, { recursive: true })
  const before = new Set(readdirSync(copy, { recursive: true }).map(String))
  // drizzle-kit prefixes `./` to --out, so hand it a path relative to the repo root.
  const out = relative(process.cwd(), copy)
  const log = execFileSync(
    'pnpm',
    ['exec', 'drizzle-kit', 'generate', '--dialect', 'sqlite', '--schema', SCHEMA, '--out', out],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  console.log(log.trim())
  // drizzle-kit can print an error and still exit 0; never let that pass as "no changes".
  if (!/No schema changes|Your SQL migration file/.test(log)) {
    throw new Error('drizzle-kit generate gave no recognisable result (see output above)')
  }
  const added = readdirSync(copy, { recursive: true })
    .map(String)
    .filter((f) => !before.has(f))
  if (added.length > 0) {
    console.error(
      `\n✗ Schema changes without a migration. Run \`pnpm db:generate --name <change>\` and commit drizzle/.\n  Would add: ${added.join(', ')}`,
    )
    failed = true
  } else {
    console.log('✓ Schema and committed migrations agree.')
  }

  // 2. Apply every committed migration to a fresh database file.
  const sqlite = new Database(join(tmp, 'empty.db'))
  try {
    migrate(drizzle({ client: sqlite }), { migrationsFolder: MIGRATIONS })
    console.log('✓ Migrations apply to an empty database.')
  } catch (error) {
    console.error('\n✗ Migrations failed on an empty database:', error)
    failed = true
  } finally {
    sqlite.close()
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
