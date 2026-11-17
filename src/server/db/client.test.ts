import { eq, sql } from 'drizzle-orm'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DB_FILE_NAME, databasePath, migrationsFolder, openDb, runMigrations } from './client'
import { appMeta } from './schema'
import { createTestDb } from './testing'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tm-db-test-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('database paths', () => {
  it('puts the file in DATA_DIR', () => {
    expect(databasePath({ DATA_DIR: '/data' })).toBe(join('/data', DB_FILE_NAME))
  })

  it('falls back to .data/ in the working directory', () => {
    expect(databasePath({})).toBe(join(resolve('.data'), DB_FILE_NAME))
  })

  it('reads migrations from drizzle/ unless MIGRATIONS_DIR says otherwise', () => {
    expect(migrationsFolder({})).toBe(resolve('drizzle'))
    expect(migrationsFolder({ MIGRATIONS_DIR: '/app/drizzle' })).toBe('/app/drizzle')
  })
})

describe('openDb', () => {
  it('creates the data folder and a WAL-mode file with foreign keys on', () => {
    const file = join(tempDir(), 'nested', DB_FILE_NAME)
    const db = openDb(file)
    expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.$client.pragma('busy_timeout', { simple: true })).toBe(5000)
    db.$client.close()
  })
})

describe('migrations', () => {
  it('bring an empty database to the current schema', () => {
    const db = createTestDb()
    db.insert(appMeta).values({ key: 'k', value: 'v' }).run()
    expect(db.select().from(appMeta).where(eq(appMeta.key, 'k')).get()).toEqual({
      key: 'k',
      value: 'v',
    })
    db.$client.close()
  })

  it('are idempotent: a second run on a migrated file changes nothing', () => {
    const file = join(tempDir(), DB_FILE_NAME)
    const first = openDb(file)
    runMigrations(first)
    first.insert(appMeta).values({ key: 'created', value: 'yes' }).run()
    first.$client.close()

    const second = openDb(file)
    runMigrations(second)
    const applied = second.get<{ n: number }>(sql`select count(*) as n from __drizzle_migrations`)
    expect(applied.n).toBeGreaterThan(0)
    expect(second.select().from(appMeta).all()).toEqual([{ key: 'created', value: 'yes' }])
    second.$client.close()
  })

  it('give each test database its own isolated state', () => {
    const a = createTestDb()
    const b = createTestDb()
    a.insert(appMeta).values({ key: 'only-in-a', value: '1' }).run()
    expect(b.select().from(appMeta).all()).toEqual([])
    a.$client.close()
    b.$client.close()
  })
})
