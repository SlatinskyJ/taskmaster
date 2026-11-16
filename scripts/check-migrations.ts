// CI migration check (#16). Fails when:
//  1. the Drizzle schema has changes that no committed migration covers, or
//  2. the migration journal is out of order (drizzle would skip a migration on existing DBs), or
//  3. the committed migrations don't apply cleanly to an empty database (same runner as boot).
// Run locally with `pnpm db:check`. Writes nothing inside the repo.
import {
  journalOrderProblems,
  migrationsApplyToEmptyDb,
  unmigratedSchemaChanges,
} from '../src/server/db/migration-check.ts'

const MIGRATIONS = 'drizzle'
const SCHEMA = './src/server/db/schema' // same as drizzle.config.ts

let failed = false

const added = unmigratedSchemaChanges(MIGRATIONS, SCHEMA)
if (added.length > 0) {
  console.error(
    `✗ Schema changes without a migration. Run \`pnpm db:generate --name <change>\` and commit drizzle/.\n  Would add: ${added.join(', ')}`,
  )
  failed = true
} else {
  console.log('✓ Schema and committed migrations agree.')
}

const order = journalOrderProblems(MIGRATIONS)
if (order.length > 0) {
  console.error(`✗ Migration journal out of order:\n  ${order.join('\n  ')}`)
  failed = true
} else {
  console.log('✓ Migration journal is in order.')
}

try {
  migrationsApplyToEmptyDb(MIGRATIONS)
  console.log('✓ Migrations apply to an empty database.')
} catch (error) {
  console.error('✗ Migrations failed on an empty database:', error)
  failed = true
}

process.exit(failed ? 1 : 0)
