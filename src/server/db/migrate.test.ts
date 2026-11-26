import Database from 'better-sqlite3'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DB_FILE_NAME, openDb, runMigrations } from './client'
import { applyMigrations } from './migrate'
import { journalOrderProblems, unmigratedSchemaChanges } from './migration-check'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tm-migrate-test-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Writes a migrations folder in drizzle-kit's layout: one SQL file per entry plus the journal. */
function writeMigrations(dir: string, migrations: { tag: string; sql: string; when?: number }[]) {
  mkdirSync(join(dir, 'meta'), { recursive: true })
  migrations.forEach((m) => {
    writeFileSync(join(dir, `${m.tag}.sql`), m.sql)
  })
  const entries = migrations.map((m, idx) => ({
    idx,
    version: '6',
    when: m.when ?? 1_700_000_000_000 + idx,
    tag: m.tag,
    breakpoints: true,
  }))
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'sqlite', entries }),
  )
}

const tables = (sqlite: Database.Database) =>
  (
    sqlite.prepare("select name from sqlite_master where type = 'table' order by name").all() as {
      name: string
    }[]
  ).map((t) => t.name)

const PARENT_CHILD = `CREATE TABLE parent (id integer PRIMARY KEY, name text NOT NULL);
--> statement-breakpoint
CREATE TABLE child (id integer PRIMARY KEY, parent_id integer NOT NULL REFERENCES parent(id) ON DELETE CASCADE);`

// What drizzle-kit writes when a column change forces a table rebuild.
const REBUILD_PARENT = `PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE __new_parent (id integer PRIMARY KEY, name text NOT NULL, note text);
--> statement-breakpoint
INSERT INTO __new_parent (id, name) SELECT id, name FROM parent;--> statement-breakpoint
DROP TABLE parent;--> statement-breakpoint
ALTER TABLE __new_parent RENAME TO parent;--> statement-breakpoint
PRAGMA foreign_keys=ON;`

describe('applyMigrations', () => {
  it('keeps child rows when a migration rebuilds their parent table', () => {
    const dir = tempDir()
    const sqlite = new Database(join(dir, 'db.sqlite'))
    sqlite.pragma('foreign_keys = ON')
    writeMigrations(join(dir, 'm'), [{ tag: '0000_tables', sql: PARENT_CHILD }])
    applyMigrations(sqlite, join(dir, 'm'))
    sqlite.exec("insert into parent values (1, 'a'); insert into child values (10, 1), (11, 1);")

    writeMigrations(join(dir, 'm'), [
      { tag: '0000_tables', sql: PARENT_CHILD },
      { tag: '0001_rebuild', sql: REBUILD_PARENT },
    ])
    applyMigrations(sqlite, join(dir, 'm'))

    expect(sqlite.prepare('select count(*) as n from child').get()).toEqual({ n: 2 })
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    sqlite.close()
  })

  it('refuses to continue after migrations that leave dangling foreign keys', () => {
    const dir = tempDir()
    const sqlite = new Database(join(dir, 'db.sqlite'))
    sqlite.pragma('foreign_keys = ON')
    writeMigrations(join(dir, 'm'), [
      { tag: '0000_tables', sql: PARENT_CHILD },
      { tag: '0001_orphan', sql: 'INSERT INTO child VALUES (1, 999);' },
    ])
    expect(() => {
      applyMigrations(sqlite, join(dir, 'm'))
    }).toThrow(/foreign key violation/)
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    sqlite.close()
  })

  it('a failing migration throws and leaves the database as it was', () => {
    const dir = tempDir()
    const file = join(dir, DB_FILE_NAME)
    writeMigrations(join(dir, 'm'), [{ tag: '0000_a', sql: 'CREATE TABLE a (id integer);' }])
    const db = openDb(file)
    runMigrations(db, join(dir, 'm'))

    writeMigrations(join(dir, 'm'), [
      { tag: '0000_a', sql: 'CREATE TABLE a (id integer);' },
      {
        tag: '0001_broken',
        sql: 'CREATE TABLE b (id integer);\n--> statement-breakpoint\nTHIS IS NOT SQL;',
      },
    ])
    expect(() => {
      runMigrations(db, join(dir, 'm'))
    }).toThrow()
    expect(tables(db.$client)).toContain('a')
    expect(tables(db.$client)).not.toContain('b')
    expect(db.$client.prepare('select count(*) as n from __drizzle_migrations').get()).toEqual({
      n: 1,
    })
    db.$client.close()
  })
})

describe('migration check (pnpm db:check)', () => {
  const schemaDir = resolve('src/server/db/schema')

  it('passes when the schema matches the committed migrations', () => {
    expect(unmigratedSchemaChanges('drizzle', './src/server/db/schema')).toEqual([])
  })

  it('fails when the schema has a change with no migration', () => {
    // A schema entry point that adds one table on top of the real schema. It must sit inside
    // the repo so drizzle-kit can resolve drizzle-orm from it.
    mkdirSync('node_modules/.cache', { recursive: true })
    const dir = mkdtempSync(resolve('node_modules/.cache/tm-schema-'))
    dirs.push(dir)
    const schema = join(dir, 'schema.ts')
    writeFileSync(
      schema,
      `export * from '${schemaDir}'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
export const unmigrated = sqliteTable('unmigrated', { id: text('id').primaryKey() })
`,
    )
    const added = unmigratedSchemaChanges('drizzle', schema)
    expect(added.some((f) => f.endsWith('.sql'))).toBe(true)
  }, 30_000)

  it('the committed journal is in order', () => {
    expect(journalOrderProblems('drizzle')).toEqual([])
  })

  it('flags a migration whose timestamp is older than the one before it', () => {
    const dir = tempDir()
    cpSync('drizzle', dir, { recursive: true })
    writeMigrations(dir, [
      { tag: '0000_a', sql: '', when: 2000 },
      { tag: '0001_b', sql: '', when: 1000 },
    ])
    expect(journalOrderProblems(dir)).toEqual([expect.stringContaining('0001_b: timestamp 1000')])
  })

  it('flags two migrations with the same timestamp', () => {
    const dir = tempDir()
    writeMigrations(dir, [
      { tag: '0000_a', sql: '', when: 1000 },
      { tag: '0001_b', sql: '', when: 1000 },
    ])
    expect(journalOrderProblems(dir)).toEqual([expect.stringContaining('0001_b: timestamp 1000')])
  })

  it('flags a migration listed out of position', () => {
    const dir = tempDir()
    writeMigrations(dir, [{ tag: '0000_a', sql: '' }])
    const path = join(dir, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(path, 'utf8')) as { entries: { idx: number }[] }
    journal.entries[0] = { ...journal.entries[0], idx: 1 }
    writeFileSync(path, JSON.stringify(journal))
    expect(journalOrderProblems(dir)).toEqual(['0000_a: idx 1, expected 0'])
  })

  it('every committed migration is recorded once after boot migrations', () => {
    const db = openDb(':memory:')
    runMigrations(db)
    const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
      entries: unknown[]
    }
    expect(db.$client.prepare('select count(*) as n from __drizzle_migrations').get()).toEqual({
      n: journal.entries.length,
    })
    runMigrations(db)
    expect(db.$client.prepare('select count(*) as n from __drizzle_migrations').get()).toEqual({
      n: journal.entries.length,
    })
    db.$client.close()
  })
})

describe('data migrations', () => {
  it('0011 gives every existing task its first offer in the thread', () => {
    const A = '2026-11-17T10:00:00.000Z'
    const B = '2026-11-17T11:00:00.000Z'
    const C = '2026-11-17T12:00:00.000Z'
    const dir = tempDir()
    const before = join(dir, 'm')
    cpSync('drizzle', before, { recursive: true })
    // Keep migrations 0000–0009 only: the state of a database before this release.
    const path = join(before, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(path, 'utf8')) as { entries: { idx: number }[] }
    journal.entries = journal.entries.filter((e) => e.idx <= 9)
    writeFileSync(path, JSON.stringify(journal))
    const sqlite = new Database(join(dir, 'db.sqlite'))
    applyMigrations(sqlite, before)
    sqlite.exec(`
      insert into users (id, username, display_name, role, created_at, updated_at)
        values (1, 'tata', 'Táta', 'giver', '${A}', '${A}');
      insert into tasks (id, title, status, score, approval_required, created_by, created_at, updated_at, agreed_at)
        values (1, 'Umýt auto', 'proposed', 18, 1, 1, '${A}', '${A}', null),
               (2, 'Vysát obývák', 'open', 10, 1, 1, '${A}', '${C}', '${B}');`)
    applyMigrations(sqlite, 'drizzle')
    expect(
      sqlite
        .prepare(
          'select task_id, user_id, side, score, created_at, closed_at, closed_as from task_thread order by task_id',
        )
        .all(),
    ).toEqual([
      {
        task_id: 1,
        user_id: 1,
        side: 'giver',
        score: 18,
        created_at: A,
        closed_at: null,
        closed_as: null,
      },
      {
        task_id: 2,
        user_id: 1,
        side: 'giver',
        score: 10,
        created_at: A,
        closed_at: B,
        closed_as: 'accepted',
      },
    ])
    sqlite.close()
  })

  it('0020 keeps every task as a one-time task, with its thread rows', () => {
    const A = '2026-11-21T10:00:00.000Z'
    const dir = tempDir()
    const before = join(dir, 'm')
    cpSync('drizzle', before, { recursive: true })
    // Keep migrations 0000–0019 only: the state of a database before instances.
    const path = join(before, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(path, 'utf8')) as { entries: { idx: number }[] }
    journal.entries = journal.entries.filter((e) => e.idx <= 19)
    writeFileSync(path, JSON.stringify(journal))
    const sqlite = new Database(join(dir, 'db.sqlite'))
    applyMigrations(sqlite, before)
    sqlite.exec(`
      insert into users (id, username, display_name, role, created_at, updated_at)
        values (1, 'tata', 'Táta', 'giver', '${A}', '${A}');
      insert into tasks (id, title, status, score, offer_round, approval_required, created_by, created_at, updated_at, agreed_at)
        values (7, 'Umýt auto', 'open', 18, 2, 1, 1, '${A}', '${A}', '${A}');
      insert into task_thread (task_id, user_id, side, score, created_at, closed_at, closed_as)
        values (7, 1, 'giver', 18, '${A}', '${A}', 'accepted');`)
    applyMigrations(sqlite, 'drizzle')
    expect(
      sqlite
        .prepare(
          'select id, title, status, score, offer_round, origin, template_id, due_at, grace_ends_at from tasks',
        )
        .all(),
    ).toEqual([
      {
        id: 7,
        title: 'Umýt auto',
        status: 'open',
        score: 18,
        offer_round: 2,
        origin: 'one_time',
        template_id: null,
        due_at: null,
        grace_ends_at: null,
      },
    ])
    expect(sqlite.prepare('select task_id from task_thread').all()).toEqual([{ task_id: 7 }])
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    sqlite.close()
  })

  it('0032 keeps every template approval as offer round 1', () => {
    const A = '2026-11-24T10:00:00.000Z'
    const dir = tempDir()
    const before = join(dir, 'm')
    cpSync('drizzle', before, { recursive: true })
    // Keep migrations 0000–0031 only: the state of a database before offer rounds on templates.
    const path = join(before, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(path, 'utf8')) as { entries: { idx: number }[] }
    journal.entries = journal.entries.filter((e) => e.idx <= 31)
    writeFileSync(path, JSON.stringify(journal))
    const sqlite = new Database(join(dir, 'db.sqlite'))
    applyMigrations(sqlite, before)
    sqlite.exec(`
      insert into users (id, username, display_name, role, created_at, updated_at)
        values (1, 'tata', 'Táta', 'giver', '${A}', '${A}'),
               (2, 'mama', 'Máma', 'giver', '${A}', '${A}');
      insert into templates (id, title, status, score, approval_required, created_by, created_at, updated_at)
        values (5, 'Vynést koš', 'proposed', 10, 1, 1, '${A}', '${A}');
      insert into template_score_approvals (template_id, user_id, score, approved_at)
        values (5, 1, 10, '${A}'), (5, 2, 10, '${A}');`)
    applyMigrations(sqlite, 'drizzle')
    expect(
      sqlite
        .prepare(
          'select template_id, user_id, score, offer_round from template_score_approvals order by user_id',
        )
        .all(),
    ).toEqual([
      { template_id: 5, user_id: 1, score: 10, offer_round: 1 },
      { template_id: 5, user_id: 2, score: 10, offer_round: 1 },
    ])
    expect(sqlite.prepare('select offer_round from templates').all()).toEqual([{ offer_round: 1 }])
    expect(sqlite.prepare('pragma foreign_key_check').all()).toEqual([])
    sqlite.close()
  })
})
