import { asc, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { login } from '~/server/auth'
import { auditLog, periods, settlements, tasks, templates, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { bootstrapAdmin } from '~/server/users'
import { ALL_FEATURES, NO_FEATURES } from '~/lib/features'
import type { Features } from '~/lib/features'
import { getFlags } from '~/server/features'
import { DEMO_PASSWORD, describeDemo, seedDemo } from './seed'
import { SEEDS } from './seeds'
import type { SeedName } from './seeds'

const T0 = new Date('2026-11-17T10:00:00.000Z')
const PREVIEW = { TASKMASTER_ENV: 'preview', NODE_ENV: 'production' }

// The guards, picking a seed by name (#183) and what holds for every seed.
describe('demo seed (#62)', () => {
  it('demo login works for every role', async () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    for (const username of ['admin', 'tata', 'starsi', 'mladsi']) {
      const r = await login(db, { username, password: DEMO_PASSWORD, ip: '127.0.0.1' }, T0)
      expect(r.ok).toBe(true)
    }
  })

  it('refuses without the preview flag (production, dev, anything else)', () => {
    for (const env of [
      {},
      { NODE_ENV: 'production' },
      { TASKMASTER_ENV: 'production' },
      { TASKMASTER_ENV: 'Preview' },
    ]) {
      const db = createTestDb()
      expect(seedDemo(db, env, T0)).toEqual({ kind: 'skipped', reason: 'not_preview' })
      expect(db.select().from(users).all()).toHaveLength(0)
    }
  })

  it('refuses a database that already has people, so a real one is never touched', () => {
    const db = createTestDb()
    bootstrapAdmin(db, { ADMIN_PASSWORD: 'correct horse battery' }, T0)
    const before = db.select().from(auditLog).all().length
    expect(seedDemo(db, PREVIEW, T0)).toEqual({ kind: 'skipped', reason: 'not_empty' })
    expect(
      db
        .select()
        .from(users)
        .all()
        .map((u) => u.username),
    ).toEqual(['admin'])
    expect(db.select().from(auditLog).all()).toHaveLength(before)
  })

  it('refuses when ADMIN_PASSWORD is set, so a real deploy never gets the demo password', () => {
    const db = createTestDb()
    const env = { ...PREVIEW, ADMIN_PASSWORD: 'correct horse battery' }
    expect(seedDemo(db, env, T0)).toEqual({ kind: 'skipped', reason: 'admin_password_set' })
    expect(db.select().from(users).all()).toHaveLength(0)
    expect(describeDemo({ kind: 'skipped', reason: 'admin_password_set' })).toContain(
      'ADMIN_PASSWORD',
    )
  })

  it('all or nothing: a failure partway leaves nobody, and the next boot seeds everyone', () => {
    const db = createTestDb()
    db.run(
      sql`CREATE TRIGGER boom BEFORE INSERT ON users WHEN NEW.username = 'starsi' BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    )
    expect(() => seedDemo(db, PREVIEW, T0)).toThrow('boom')
    expect(db.select().from(users).all()).toHaveLength(0)
    expect(db.select().from(auditLog).all()).toHaveLength(0)
    expect(db.select().from(tasks).all()).toHaveLength(0)
    db.run(sql`DROP TRIGGER boom`)
    expect(seedDemo(db, PREVIEW, T0).kind).toBe('seeded')
    expect(db.select().from(users).all()).toHaveLength(4)
  })

  it('leaves the switches alone when it does not seed', () => {
    const db = createTestDb()
    db.run(sql`UPDATE feature_flags SET enabled = 0 WHERE key = 'week'`)
    seedDemo(db, { NODE_ENV: 'production' }, T0)
    expect(getFlags(db)).toEqual({
      ...ALL_FEATURES,
      week: false,
      disputes: false,
      passwordChange: false,
      bidRefusals: false,
      approveAnywhere: false,
      reopenBidding: false,
      choreBidding: false,
      openRows: false,
      descriptions: false,
      weekPlan: false,
    })
  })

  it('the audit log is in time order (#45)', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    const at = db
      .select({ at: auditLog.at })
      .from(auditLog)
      .orderBy(asc(auditLog.id))
      .all()
      .map((r) => r.at)
    expect(at).toEqual([...at].sort())
  })

  it('a second boot seeds nothing more', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    expect(seedDemo(db, PREVIEW, T0)).toEqual({ kind: 'skipped', reason: 'not_empty' })
    expect(db.select().from(users).all()).toHaveLength(4)
  })

  it('boot messages: silent outside previews, says the password inside', () => {
    expect(describeDemo({ kind: 'skipped', reason: 'not_preview' })).toBeNull()
    expect(describeDemo({ kind: 'skipped', reason: 'not_empty' })).toContain('not seeding')
    expect(describeDemo({ kind: 'seeded', seed: 'home', usernames: ['admin'] })).toMatch(
      /seeded home: admin .*demo1234/,
    )
  })
  it('TASKMASTER_SEED picks the seed; unset or empty is demo', () => {
    for (const name of [undefined, '']) {
      const db = createTestDb()
      expect(seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: name }, T0)).toEqual({
        kind: 'seeded',
        seed: 'demo',
        usernames: ['admin', 'tata', 'starsi', 'mladsi'],
      })
    }
    const db = createTestDb()
    expect(seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: 'family' }, T0)).toMatchObject({
      kind: 'seeded',
      seed: 'family',
    })
    expect(db.select().from(users).all()).toHaveLength(4)
    for (const table of [tasks, templates, periods, settlements]) {
      expect(db.select().from(table).all()).toHaveLength(0)
    }
  })

  it('an unknown TASKMASTER_SEED fails the boot and seeds nothing', () => {
    for (const name of ['Home', 'nope', 'toString', 'constructor']) {
      const db = createTestDb()
      expect(() => seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: name }, T0)).toThrow(
        `unknown TASKMASTER_SEED "${name}" (known: family, home, launch, approve, rows, tasks, bids, rebid, week, recurring, chores, chorechange, scheduler, proposals, disputes, corrections, descriptions, password, demo)`,
      )
      expect(db.select().from(users).all()).toHaveLength(0)
      expect(db.select().from(auditLog).all()).toHaveLength(0)
    }
  })

  it('a misspelt TASKMASTER_SEED fails a later boot too, and adds nothing', () => {
    const db = createTestDb()
    seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: 'home' }, T0)
    const before = db.select().from(auditLog).all().length
    expect(() => seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: 'Home' }, T0)).toThrow(
      'unknown TASKMASTER_SEED "Home"',
    )
    expect(db.select().from(auditLog).all()).toHaveLength(before)
  })

  it('TASKMASTER_SEED never matters outside a preview', () => {
    const db = createTestDb()
    expect(seedDemo(db, { TASKMASTER_SEED: 'nope' }, T0)).toEqual({
      kind: 'skipped',
      reason: 'not_preview',
    })
    const env = { ...PREVIEW, ADMIN_PASSWORD: 'correct horse battery', TASKMASTER_SEED: 'nope' }
    expect(seedDemo(db, env, T0)).toEqual({ kind: 'skipped', reason: 'admin_password_set' })
    expect(db.select().from(users).all()).toHaveLength(0)
  })

  it('each seed turns on its switches and turns the rest off', () => {
    const expected: Record<SeedName, Features> = {
      family: NO_FEATURES,
      home: NO_FEATURES,
      launch: NO_FEATURES,
      approve: { ...NO_FEATURES, approveAnywhere: true },
      rows: { ...NO_FEATURES, recurring: true, week: true, openRows: true },
      tasks: NO_FEATURES,
      bids: { ...NO_FEATURES, bidRefusals: true },
      rebid: { ...NO_FEATURES, reopenBidding: true, bidRefusals: true },
      week: { ...NO_FEATURES, week: true, meeting: true },
      recurring: { ...NO_FEATURES, recurring: true, log: true },
      chores: { ...NO_FEATURES, recurring: true, choreBidding: true },
      chorechange: { ...NO_FEATURES, recurring: true, bidRefusals: true },
      scheduler: { ...NO_FEATURES, recurring: true },
      proposals: { ...NO_FEATURES, week: true, periodProposals: true },
      disputes: { ...NO_FEATURES, week: true, disputes: true, recurring: true },
      corrections: { ...NO_FEATURES, week: true, disputes: true },
      descriptions: { ...NO_FEATURES, descriptions: true, openRows: true, recurring: true },
      password: { ...NO_FEATURES, passwordChange: true },
      demo: ALL_FEATURES,
    }
    for (const name of Object.keys(SEEDS) as SeedName[]) {
      const db = createTestDb()
      seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: name }, T0)
      expect(getFlags(db), name).toEqual(expected[name])
    }
  })

  it('every seed: the family logs in and the audit log is in time order', async () => {
    for (const name of Object.keys(SEEDS)) {
      const db = createTestDb()
      seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: name }, T0)
      for (const username of ['admin', 'tata', 'starsi', 'mladsi']) {
        const r = await login(db, { username, password: DEMO_PASSWORD, ip: '127.0.0.1' }, T0)
        expect(r.ok, `${name}: ${username}`).toBe(true)
      }
      const at = db
        .select({ at: auditLog.at })
        .from(auditLog)
        .orderBy(asc(auditLog.id))
        .all()
        .map((r) => r.at)
      expect(at, name).toEqual([...at].sort())
    }
  })

  it('all or nothing: a failing switch leaves nobody, no tasks, every switch as it was', () => {
    const db = createTestDb()
    db.run(
      sql`CREATE TRIGGER boom BEFORE INSERT ON audit_log WHEN NEW.action = 'feature.switched' BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    )
    expect(() => seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: 'launch' }, T0)).toThrow('boom')
    expect(db.select().from(users).all()).toHaveLength(0)
    expect(db.select().from(tasks).all()).toHaveLength(0)
    expect(getFlags(db)).toEqual({
      ...ALL_FEATURES,
      disputes: false,
      passwordChange: false,
      bidRefusals: false,
      approveAnywhere: false,
      reopenBidding: false,
      choreBidding: false,
      openRows: false,
      descriptions: false,
      weekPlan: false,
    })
  })
})
