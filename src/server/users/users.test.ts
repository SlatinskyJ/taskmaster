import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { allParties } from '~/domain'
import { createTestDb } from '~/server/db/testing'
import { auditLog, users } from '~/server/db/schema'
import type { FamilyConfig } from './config'
import { parseFamilyConfig } from './config'
import type { PeopleChangeHook } from './people'
import { listPeople } from './people'
import { familyConfigPath, seedUsers, seedUsersFromFile } from './seed'

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo'
const T0 = new Date('2026-11-17T10:00:00.000Z')
const T1 = new Date('2026-11-18T10:00:00.000Z')

const family: FamilyConfig = parseFamilyConfig(
  JSON.stringify({
    users: [
      { username: 'admin', displayName: 'Admin', role: 'admin', passwordHash: HASH },
      { username: 'giver', displayName: 'Táta', role: 'giver' },
      { username: 'taker1', displayName: 'Starší', role: 'taker' },
      { username: 'taker2', displayName: 'Mladší', role: 'taker' },
    ],
  }),
)
const withMum = (active: boolean): FamilyConfig => ({
  users: [
    ...family.users,
    { username: 'mama', displayName: 'Máma', role: 'giver', active, passwordHash: null },
  ],
})

describe('family config parsing (spec §6)', () => {
  it('reads users; active defaults to true; hashes are optional', () => {
    expect(family.users[1]).toEqual({
      username: 'giver',
      displayName: 'Táta',
      role: 'giver',
      active: true,
      passwordHash: null,
    })
    expect(family.users[0]?.passwordHash).toBe(HASH)
  })

  it('the example file in the repo is valid', async () => {
    const { readFileSync } = await import('node:fs')
    const example = parseFamilyConfig(readFileSync('config/family.example.json', 'utf8'))
    expect(example.users.map((u) => u.role).sort()).toEqual([
      'admin',
      'giver',
      'giver',
      'taker',
      'taker',
    ])
  })

  it('lists every problem at once and never accepts a plain password', () => {
    const bad = JSON.stringify({
      users: [
        { username: 'Tata', displayName: 'Táta', role: 'giver' },
        { username: 'x', displayName: '', role: 'boss' },
        { username: 'ok', displayName: 'Ok', role: 'taker', password: 'hunter2' },
        { username: 'ok', displayName: 'Ok', role: 'taker', active: 'yes' },
        { username: 'h', displayName: 'H', role: 'taker', passwordHash: 'plain' },
      ],
    })
    let message = ''
    try {
      parseFamilyConfig(bad)
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('users[0]: username')
    expect(message).toContain('users[1]: displayName')
    expect(message).toContain('users[1]: role')
    expect(message).toContain('users[2]: unknown field "password"')
    expect(message).toContain('users[3]: duplicate username "ok"')
    expect(message).toContain('users[3]: active')
    expect(message).toContain('users[4]: passwordHash')
    expect(message).not.toContain('hunter2')
  })

  it('pins the length limits and a blank name', () => {
    const one = (u: Record<string, unknown>) => () =>
      parseFamilyConfig(JSON.stringify({ users: [{ displayName: 'A', role: 'taker', ...u }] }))
    expect(one({ username: 'ab' })).not.toThrow()
    expect(one({ username: 'a'.repeat(32) })).not.toThrow()
    expect(one({ username: 'x' })).toThrow('users[0]: username')
    expect(one({ username: 'a'.repeat(33) })).toThrow('users[0]: username')
    expect(one({ username: 'ok', displayName: 'N'.repeat(40) })).not.toThrow()
    expect(one({ username: 'ok', displayName: 'N'.repeat(41) })).toThrow('users[0]: displayName')
    expect(one({ username: 'ok', displayName: '   ' })).toThrow('users[0]: displayName')
  })

  it('refuses non-JSON and a wrong shape', () => {
    expect(() => parseFamilyConfig('{')).toThrow('not valid JSON')
    expect(() => parseFamilyConfig('[]')).toThrow('expected { "users"')
  })
})

describe('seeding people (spec §3, §6)', () => {
  it('creates admin, giver and takers; the admin is not a party', () => {
    const db = createTestDb()
    expect(seedUsers(db, family, T0)).toEqual({
      created: ['admin', 'giver', 'taker1', 'taker2'],
      updated: [],
    })
    const rows = db.select().from(users).all()
    expect(rows.map((r) => [r.username, r.role, r.active])).toEqual([
      ['admin', 'admin', true],
      ['giver', 'giver', true],
      ['taker1', 'taker', true],
      ['taker2', 'taker', true],
    ])
    expect(rows[0]?.createdAt).toBe(T0.toISOString())
    const people = listPeople(db)
    expect(allParties(people)).toEqual(rows.filter((r) => r.role !== 'admin').map((r) => r.id))
  })

  it('is idempotent: a second run changes nothing and logs nothing', () => {
    const db = createTestDb()
    seedUsers(db, family, T0)
    const logged = db.select().from(auditLog).all().length
    expect(seedUsers(db, family, T1)).toEqual({ created: [], updated: [] })
    expect(db.select().from(auditLog).all()).toHaveLength(logged)
  })

  it('adding Mum is a config change only; deactivating her drops her from the parties', () => {
    const db = createTestDb()
    seedUsers(db, family, T0)
    expect(seedUsers(db, withMum(true), T1).created).toEqual(['mama'])
    const mum = db
      .select()
      .from(users)
      .all()
      .find((u) => u.username === 'mama')
    expect(allParties(listPeople(db))).toContain(mum?.id)
    expect(seedUsers(db, withMum(false), T1).updated).toEqual(['mama'])
    expect(allParties(listPeople(db))).not.toContain(mum?.id)
  })

  it('people missing from the config are left as they are', () => {
    const db = createTestDb()
    seedUsers(db, withMum(true), T0)
    seedUsers(db, family, T1)
    expect(db.select().from(users).all()).toHaveLength(5)
  })

  it('every change is audit-logged without the hash', () => {
    const db = createTestDb()
    seedUsers(db, family, T0)
    const entries = db.select().from(auditLog).all()
    expect(entries).toHaveLength(4)
    const admin = entries[0]
    expect(admin).toMatchObject({
      actorKind: 'system',
      action: 'user.created',
      entityType: 'user',
      reason: 'family config',
      at: T0.toISOString(),
    })
    expect(JSON.parse(admin?.after ?? '{}')).toEqual({
      username: 'admin',
      displayName: 'Admin',
      role: 'admin',
      active: true,
      hashSet: true,
    })
    expect(JSON.stringify(entries)).not.toContain('argon2')
  })

  it('a role change is logged with before and after', () => {
    const db = createTestDb()
    seedUsers(db, family, T0)
    const changed: FamilyConfig = {
      users: family.users.map((u) => (u.username === 'taker1' ? { ...u, role: 'giver' } : u)),
    }
    seedUsers(db, changed, T1)
    const last = db.select().from(auditLog).all().at(-1)
    expect(last?.action).toBe('user.updated')
    expect(JSON.parse(last?.before ?? '{}')).toMatchObject({ role: 'taker' })
    expect(JSON.parse(last?.after ?? '{}')).toMatchObject({ role: 'giver' })
  })

  it('a display-name change alone is applied and logged', () => {
    const db = createTestDb()
    seedUsers(db, family, T0)
    const renamed: FamilyConfig = {
      users: family.users.map((u) =>
        u.username === 'giver' ? { ...u, displayName: 'Tatínek' } : u,
      ),
    }
    expect(seedUsers(db, renamed, T1).updated).toEqual(['giver'])
    expect(db.select().from(users).all()[1]?.displayName).toBe('Tatínek')
    const last = db.select().from(auditLog).all().at(-1)
    expect(JSON.parse(last?.before ?? '{}')).toMatchObject({ displayName: 'Táta' })
    expect(JSON.parse(last?.after ?? '{}')).not.toHaveProperty('hashChanged')
  })

  it('a hash in the config replaces the stored one; no hash keeps it', () => {
    const db = createTestDb()
    seedUsers(db, family, T0)
    const NEW = `${HASH}x`
    const rotated: FamilyConfig = {
      users: family.users.map((u) => (u.username === 'admin' ? { ...u, passwordHash: NEW } : u)),
    }
    expect(seedUsers(db, rotated, T1).updated).toEqual(['admin'])
    const rotation = db.select().from(auditLog).all().at(-1)
    expect(JSON.parse(rotation?.before ?? '{}')).toMatchObject({ hashSet: true })
    expect(JSON.parse(rotation?.after ?? '{}')).toMatchObject({ hashSet: true, hashChanged: true })
    expect(JSON.stringify(rotation)).not.toContain('argon2')
    const noHash: FamilyConfig = {
      users: family.users.map((u) => ({ ...u, passwordHash: null })),
    }
    expect(seedUsers(db, noHash, T1).updated).toEqual([])
    expect(db.select().from(users).all()[0]?.passwordHash).toBe(NEW)
  })

  it('runs people-change hooks in the same transaction, only when people changed', () => {
    const db = createTestDb()
    const calls: number[] = []
    const hooks: PeopleChangeHook[] = [(_tx, people) => calls.push(people.length)]
    seedUsers(db, family, T0, hooks)
    seedUsers(db, family, T1, hooks)
    seedUsers(db, withMum(true), T1, hooks)
    expect(calls).toEqual([4, 5])
  })

  it('a failing hook rolls the whole seed back, audit included', () => {
    const db = createTestDb()
    const hooks: PeopleChangeHook[] = [
      () => {
        throw new Error('boom')
      },
    ]
    expect(() => seedUsers(db, family, T0, hooks)).toThrow('boom')
    expect(db.select().from(users).all()).toHaveLength(0)
    expect(db.select().from(auditLog).all()).toHaveLength(0)
  })

  it('a failing audit write rolls the user change back', () => {
    const db = createTestDb()
    seedUsers(db, family, T0)
    db.run(
      sql`CREATE TRIGGER no_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END`,
    )
    expect(() => seedUsers(db, withMum(true), T1)).toThrow('audit down')
    expect(
      db
        .select()
        .from(users)
        .all()
        .map((u) => u.username),
    ).not.toContain('mama')
  })
})

describe('boot: config file', () => {
  it('path: FAMILY_CONFIG, else DATA_DIR/family.json', () => {
    expect(familyConfigPath({ FAMILY_CONFIG: '/etc/tm/family.json' })).toBe('/etc/tm/family.json')
    expect(familyConfigPath({ DATA_DIR: '/data' })).toBe('/data/family.json')
  })

  it('a missing file seeds nothing; a present one is applied', () => {
    const db = createTestDb()
    const dir = mkdtempSync(join(tmpdir(), 'tm-family-'))
    const file = join(dir, 'family.json')
    expect(seedUsersFromFile(db, file)).toBeNull()
    writeFileSync(
      file,
      JSON.stringify({ users: [{ username: 'giver', displayName: 'Táta', role: 'giver' }] }),
    )
    expect(seedUsersFromFile(db, file)).toEqual({ created: ['giver'], updated: [] })
  })

  it('an invalid file throws, so the server does not start on it', () => {
    const db = createTestDb()
    const dir = mkdtempSync(join(tmpdir(), 'tm-family-'))
    const file = join(dir, 'family.json')
    writeFileSync(file, '{"users":[{"username":"X"}]}')
    expect(() => seedUsersFromFile(db, file)).toThrow('Family config')
  })
})
