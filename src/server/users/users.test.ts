import { verify } from '@node-rs/argon2'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { allParties } from '~/domain'
import type { Actor } from '~/server/audit'
import type { Db } from '~/server/db'
import { auditLog, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { bootstrapAdmin, describeBootstrap, MIN_ADMIN_PASSWORD } from './bootstrap'
import type { NewUser } from './manage'
import { createUser, setPasswordHash, updateUser } from './manage'
import type { PeopleChangeHook } from './people'
import { listPeople } from './people'

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNo'
const T0 = new Date('2026-11-17T10:00:00.000Z')
const T1 = new Date('2026-11-18T10:00:00.000Z')
const SYSTEM: Actor = { kind: 'system' }
const NO_HOOKS: PeopleChangeHook[] = []

function must<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

/** Admin + Táta + two takers, the admin created by the system (bootstrap). */
function family(db: Db = createTestDb()) {
  const admin = must(
    createUser(
      db,
      SYSTEM,
      { username: 'admin', displayName: 'Admin', role: 'admin', passwordHash: HASH },
      T0,
    ),
  )
  const by: Actor = { kind: 'user', userId: admin.id }
  const add = (u: NewUser) => must(createUser(db, by, u, T0))
  const giver = add({ username: 'tata', displayName: 'Táta', role: 'giver' })
  const older = add({ username: 'starsi', displayName: 'Starší', role: 'taker' })
  const younger = add({ username: 'mladsi', displayName: 'Mladší', role: 'taker' })
  return { db, admin, by, giver, older, younger }
}

const auditRows = (db: Db) => db.select().from(auditLog).all()

describe('adding people in the admin console (spec §6)', () => {
  it('the admin adds givers and takers; the admin is not a party', () => {
    const { db, admin, giver, older, younger } = family()
    expect(
      db
        .select()
        .from(users)
        .all()
        .map((u) => [u.username, u.role, u.active]),
    ).toEqual([
      ['admin', 'admin', true],
      ['tata', 'giver', true],
      ['starsi', 'taker', true],
      ['mladsi', 'taker', true],
    ])
    expect(allParties(listPeople(db))).toEqual([giver.id, older.id, younger.id])
    expect(admin.createdAt).toBe(T0.toISOString())
  })

  it('adding Mum later is one admin action, and she joins the parties', () => {
    const { db, by } = family()
    const mum = must(
      createUser(db, by, { username: 'mama', displayName: 'Máma', role: 'giver' }, T1),
    )
    expect(allParties(listPeople(db))).toContain(mum.id)
  })

  it('every change is audit-logged by its actor, never with the hash', () => {
    const { db, admin, giver } = family()
    const [first, second] = auditRows(db)
    expect(first).toMatchObject({
      action: 'user.created',
      actorKind: 'system',
      entityId: String(admin.id),
    })
    expect(second).toMatchObject({
      action: 'user.created',
      actorKind: 'user',
      actorUserId: admin.id,
      entityId: String(giver.id),
    })
    expect(JSON.parse(first?.after ?? '{}')).toEqual({
      username: 'admin',
      displayName: 'Admin',
      role: 'admin',
      active: true,
      hashSet: true,
    })
    expect(JSON.stringify(auditRows(db))).not.toContain('argon2')
  })

  it('refuses bad input before touching the DB', () => {
    const { db, by } = family()
    const before = auditRows(db).length
    const add = (u: Partial<NewUser>) =>
      createUser(db, by, { username: 'ok', displayName: 'Ok', role: 'taker', ...u }, T1)
    expect(add({ username: 'Tata' })).toEqual({ ok: false, error: 'invalid_username' })
    expect(add({ username: 'x' })).toEqual({ ok: false, error: 'invalid_username' })
    expect(add({ username: 'a'.repeat(33) })).toEqual({ ok: false, error: 'invalid_username' })
    expect(add({ displayName: '   ' })).toEqual({ ok: false, error: 'invalid_name' })
    expect(add({ displayName: 'N'.repeat(41) })).toEqual({ ok: false, error: 'invalid_name' })
    expect(add({ role: 'boss' as NewUser['role'] })).toEqual({ ok: false, error: 'invalid_role' })
    expect(add({ passwordHash: 'hunter2' })).toEqual({ ok: false, error: 'invalid_hash' })
    expect(add({ username: 'tata' })).toEqual({ ok: false, error: 'username_taken' })
    expect(auditRows(db)).toHaveLength(before)
    expect(add({ username: 'a'.repeat(32), displayName: 'N'.repeat(40) }).ok).toBe(true)
  })

  it('only an active admin (or the system) may manage people', () => {
    const { db, by, giver, older } = family()
    const asGiver: Actor = { kind: 'user', userId: giver.id }
    const u = { username: 'host', displayName: 'Host', role: 'taker' } as const
    expect(createUser(db, asGiver, u, T1)).toEqual({ ok: false, error: 'not_admin' })
    expect(createUser(db, { kind: 'anonymous' }, u, T1)).toEqual({ ok: false, error: 'not_admin' })
    expect(updateUser(db, asGiver, older.id, { active: false }, T1)).toEqual({
      ok: false,
      error: 'not_admin',
    })
    expect(setPasswordHash(db, asGiver, older.id, HASH, T1)).toEqual({
      ok: false,
      error: 'not_admin',
    })
    // A second admin, deactivated, loses the right.
    const second = must(
      createUser(db, by, { username: 'admin2', displayName: 'A2', role: 'admin' }, T1),
    )
    must(updateUser(db, by, second.id, { active: false }, T1))
    expect(createUser(db, { kind: 'user', userId: second.id }, u, T1)).toEqual({
      ok: false,
      error: 'not_admin',
    })
  })
})

describe('changing people (spec §3, §6)', () => {
  it('rename, role change, deactivate and reactivate, each logged with before and after', () => {
    const { db, by, older } = family()
    expect(must(updateUser(db, by, older.id, { displayName: '  Honza  ' }, T1)).displayName).toBe(
      'Honza',
    )
    must(updateUser(db, by, older.id, { role: 'giver' }, T1))
    must(updateUser(db, by, older.id, { active: false }, T1))
    expect(allParties(listPeople(db))).not.toContain(older.id)
    must(updateUser(db, by, older.id, { active: true }, T1))
    const log = auditRows(db).slice(-4)
    expect(log.map((r) => r.action)).toEqual(Array(4).fill('user.updated'))
    expect(JSON.parse(log[0]?.before ?? '{}')).toMatchObject({ displayName: 'Starší' })
    expect(JSON.parse(log[0]?.after ?? '{}')).toMatchObject({ displayName: 'Honza' })
    expect(JSON.parse(log[1]?.after ?? '{}')).toMatchObject({ role: 'giver' })
    expect(JSON.parse(log[2]?.after ?? '{}')).toMatchObject({ active: false })
    expect(JSON.parse(log[3]?.after ?? '{}')).toMatchObject({ active: true })
    expect(
      db
        .select()
        .from(users)
        .all()
        .find((u) => u.id === older.id)?.updatedAt,
    ).toBe(T1.toISOString())
  })

  it('a change to nothing new writes nothing', () => {
    const { db, by, older } = family()
    const before = auditRows(db).length
    expect(
      must(updateUser(db, by, older.id, { displayName: 'Starší', role: 'taker' }, T1)),
    ).toEqual(older)
    expect(auditRows(db)).toHaveLength(before)
  })

  it('unknown user and bad values are refused', () => {
    const { db, by, older } = family()
    expect(updateUser(db, by, 999, { active: false }, T1)).toEqual({
      ok: false,
      error: 'not_found',
    })
    expect(updateUser(db, by, older.id, { displayName: '' }, T1)).toEqual({
      ok: false,
      error: 'invalid_name',
    })
    expect(setPasswordHash(db, by, 999, HASH, T1)).toEqual({ ok: false, error: 'not_found' })
  })

  it('the last active admin cannot be deactivated or demoted', () => {
    const { db, by, admin } = family()
    expect(updateUser(db, by, admin.id, { active: false }, T1)).toEqual({
      ok: false,
      error: 'last_admin',
    })
    expect(updateUser(db, by, admin.id, { role: 'giver' }, T1)).toEqual({
      ok: false,
      error: 'last_admin',
    })
    const second = must(
      createUser(db, by, { username: 'admin2', displayName: 'A2', role: 'admin' }, T1),
    )
    // An inactive second admin doesn't count.
    must(updateUser(db, by, second.id, { active: false }, T1))
    expect(updateUser(db, by, admin.id, { active: false }, T1)).toEqual({
      ok: false,
      error: 'last_admin',
    })
    expect(updateUser(db, by, admin.id, { role: 'giver' }, T1)).toEqual({
      ok: false,
      error: 'last_admin',
    })
    must(updateUser(db, by, second.id, { active: true }, T1))
    expect(updateUser(db, by, admin.id, { active: false }, T1).ok).toBe(true)
  })

  it('a password reset replaces the hash and the log says so without showing it', () => {
    const { db, by, older } = family()
    must(setPasswordHash(db, by, older.id, HASH, T1))
    expect(
      db
        .select()
        .from(users)
        .all()
        .find((u) => u.id === older.id)?.passwordHash,
    ).toBe(HASH)
    const row = auditRows(db).at(-1)
    expect(JSON.parse(row?.before ?? '{}')).toMatchObject({ hashSet: false })
    expect(JSON.parse(row?.after ?? '{}')).toMatchObject({ hashSet: true, hashChanged: true })
    expect(JSON.stringify(row)).not.toContain('argon2')
    expect(setPasswordHash(db, by, older.id, 'plain', T1)).toEqual({
      ok: false,
      error: 'invalid_hash',
    })
  })
})

describe('people-change hooks (spec §3)', () => {
  it('run in the same transaction when someone is added or takes part differently, not on a rename', () => {
    const { db, by, older } = family()
    const calls: number[] = []
    const hooks: PeopleChangeHook[] = [(_tx, people) => calls.push(people.length)]
    must(createUser(db, by, { username: 'mama', displayName: 'Máma', role: 'giver' }, T1, hooks))
    must(updateUser(db, by, older.id, { displayName: 'Honza' }, T1, hooks))
    must(updateUser(db, by, older.id, { active: false }, T1, hooks))
    must(updateUser(db, by, older.id, { role: 'giver' }, T1, hooks))
    expect(calls).toEqual([5, 5, 5])
  })

  it('a failing hook rolls the change back, audit included', () => {
    const { db, by, older } = family()
    const before = auditRows(db).length
    const boom: PeopleChangeHook[] = [
      () => {
        throw new Error('boom')
      },
    ]
    expect(() => updateUser(db, by, older.id, { active: false }, T1, boom)).toThrow('boom')
    expect(
      db
        .select()
        .from(users)
        .all()
        .find((u) => u.id === older.id)?.active,
    ).toBe(true)
    expect(auditRows(db)).toHaveLength(before)
  })

  it('a failing audit write rolls the user change back', () => {
    const { db, by } = family()
    db.run(
      sql`CREATE TRIGGER no_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END`,
    )
    expect(() =>
      createUser(db, by, { username: 'mama', displayName: 'Máma', role: 'giver' }, T1, NO_HOOKS),
    ).toThrow('audit down')
    expect(
      db
        .select()
        .from(users)
        .all()
        .map((u) => u.username),
    ).not.toContain('mama')
  })
})

describe('first admin from ADMIN_PASSWORD (spec §6)', () => {
  const PASSWORD = 'correct horse battery'

  it('creates the admin on an empty DB with a real argon2id hash', async () => {
    const db = createTestDb()
    const outcome = bootstrapAdmin(db, { ADMIN_PASSWORD: PASSWORD, ADMIN_USERNAME: 'jakub' }, T0)
    expect(outcome).toEqual({ kind: 'created', username: 'jakub', testUsers: [] })
    const [row] = db.select().from(users).all()
    expect(row).toMatchObject({ username: 'jakub', role: 'admin', active: true })
    expect(row?.passwordHash?.startsWith('$argon2id$')).toBe(true)
    await expect(verify(row?.passwordHash ?? '', PASSWORD)).resolves.toBe(true)
    expect(auditRows(db)[0]).toMatchObject({ action: 'user.created', actorKind: 'system' })
    expect(describeBootstrap(outcome)).not.toContain(PASSWORD)
  })

  it('username defaults to "admin"', () => {
    const db = createTestDb()
    expect(bootstrapAdmin(db, { ADMIN_PASSWORD: PASSWORD }, T0)).toEqual({
      kind: 'created',
      username: 'admin',
      testUsers: [],
    })
  })

  it('does nothing once an admin exists, and asks to remove a leftover variable', () => {
    const { db } = family()
    const before = auditRows(db).length
    expect(bootstrapAdmin(db, { ADMIN_PASSWORD: PASSWORD }, T1)).toEqual({ kind: 'remove_env' })
    expect(bootstrapAdmin(db, {}, T1)).toEqual({ kind: 'nothing' })
    expect(
      db
        .select()
        .from(users)
        .all()
        .filter((u) => u.role === 'admin'),
    ).toHaveLength(1)
    expect(auditRows(db)).toHaveLength(before)
    expect(describeBootstrap({ kind: 'remove_env' })).toContain('remove')
    expect(describeBootstrap({ kind: 'nothing' })).toBeNull()
  })

  it('no admin and no variable: warns, creates nothing', () => {
    const db = createTestDb()
    expect(bootstrapAdmin(db, {}, T0)).toEqual({ kind: 'no_admin' })
    expect(db.select().from(users).all()).toHaveLength(0)
    expect(describeBootstrap({ kind: 'no_admin' })).toContain('ADMIN_PASSWORD')
  })

  it('a short password or bad username stops boot without echoing the password', () => {
    const short = 'x'.repeat(MIN_ADMIN_PASSWORD - 1)
    const db = createTestDb()
    expect(() => bootstrapAdmin(db, { ADMIN_PASSWORD: short }, T0)).toThrow(/at least 12/)
    expect(() => bootstrapAdmin(db, { ADMIN_PASSWORD: short }, T0)).not.toThrow(short)
    expect(() =>
      bootstrapAdmin(db, { ADMIN_PASSWORD: PASSWORD, ADMIN_USERNAME: 'Jakub' }, T0),
    ).toThrow('invalid_username')
    expect(db.select().from(users).all()).toHaveLength(0)
    expect(bootstrapAdmin(db, { ADMIN_PASSWORD: 'x'.repeat(MIN_ADMIN_PASSWORD) }, T0).kind).toBe(
      'created',
    )
  })

  it('TEST_USERS=1 adds Táta, Starší and Mladší with the same password, in dev or preview', async () => {
    const db = createTestDb()
    const outcome = bootstrapAdmin(db, { ADMIN_PASSWORD: PASSWORD, TEST_USERS: '1' }, T0)
    expect(outcome).toEqual({
      kind: 'created',
      username: 'admin',
      testUsers: ['tata', 'starsi', 'mladsi'],
    })
    const rows = db.select().from(users).all()
    expect(rows.map((u) => [u.username, u.role])).toEqual([
      ['admin', 'admin'],
      ['tata', 'giver'],
      ['starsi', 'taker'],
      ['mladsi', 'taker'],
    ])
    expect(await verify(rows[3]?.passwordHash ?? '', PASSWORD)).toBe(true)
    expect(describeBootstrap(outcome)).toContain('mladsi')
    const preview = createTestDb()
    const env = {
      ADMIN_PASSWORD: PASSWORD,
      TEST_USERS: '1',
      NODE_ENV: 'production',
      TASKMASTER_ENV: 'preview',
    }
    expect(bootstrapAdmin(preview, env, T0)).toMatchObject({
      testUsers: ['tata', 'starsi', 'mladsi'],
    })
  })

  it('TEST_USERS other than "1" adds nobody', () => {
    const db = createTestDb()
    const env = { ADMIN_PASSWORD: PASSWORD, TEST_USERS: '0' }
    expect(bootstrapAdmin(db, env, T0)).toMatchObject({ testUsers: [] })
    expect(db.select().from(users).all()).toHaveLength(1)
  })

  it('TEST_USERS is ignored in production', () => {
    const db = createTestDb()
    const env = { ADMIN_PASSWORD: PASSWORD, TEST_USERS: '1', NODE_ENV: 'production' }
    expect(bootstrapAdmin(db, env, T0)).toEqual({
      kind: 'created',
      username: 'admin',
      testUsers: [],
    })
    expect(db.select().from(users).all()).toHaveLength(1)
  })

  it('a failing test user rolls the admin back too', () => {
    const db = createTestDb()
    const env = { ADMIN_PASSWORD: PASSWORD, ADMIN_USERNAME: 'tata', TEST_USERS: '1' }
    expect(() => bootstrapAdmin(db, env, T0)).toThrow('username_taken')
    expect(db.select().from(users).all()).toHaveLength(0)
    expect(auditRows(db)).toHaveLength(0)
  })
})
