import { asc, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { login } from '~/server/auth'
import {
  auditLog,
  periods,
  settlements,
  suggestions,
  tasks,
  templates,
  users,
} from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { bootstrapAdmin } from '~/server/users'
import { ALL_FEATURES, NO_FEATURES } from '~/lib/features'
import { cs } from '~/lib/strings'
import type { Features } from '~/lib/features'
import { getFlags } from '~/server/features'
import { DEMO_PASSWORD, DEMO_USERS, describeDemo, seedDemo } from './seed'
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

  // #353 (Jakub 2026-11-28): the demo kids are Anička (starsi) and Béďa (mladsi).
  it('seeds the demo family under its display names', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    const rows = db
      .select({ username: users.username, displayName: users.displayName })
      .from(users)
      .orderBy(asc(users.id))
      .all()
      .map((u) => [u.username, u.displayName])
    expect(rows).toEqual([
      ['admin', 'Admin'],
      ['tata', 'Táta'],
      ['starsi', 'Anička'],
      ['mladsi', 'Béďa'],
    ])
  })

  it('the /dev/multi labels match the seeded names', () => {
    for (const u of DEMO_USERS) {
      const key = u.username as keyof typeof cs.devMulti.users
      expect(cs.devMulti.users[key], u.username).toBe(u.displayName)
    }
    expect(Object.keys(cs.devMulti.users)).toEqual(DEMO_USERS.map((u) => u.username))
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

  it('seeds the demo (TASKMASTER_ENV=demo), and refuses it with ADMIN_PASSWORD', () => {
    const db = createTestDb()
    expect(seedDemo(db, { TASKMASTER_ENV: 'demo', NODE_ENV: 'production' }, T0)).toMatchObject({
      kind: 'seeded',
      seed: 'demo',
    })
    const other = createTestDb()
    const env = { TASKMASTER_ENV: 'demo', ADMIN_PASSWORD: 'correct horse battery' }
    expect(seedDemo(other, env, T0)).toEqual({ kind: 'skipped', reason: 'admin_password_set' })
    expect(other.select().from(users).all()).toHaveLength(0)
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
      suggestions: false,
      liveChanges: false,
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
        `unknown TASKMASTER_SEED "${name}" (known: family, home, launch, approve, rows, tasks, bids, rebid, week, recurring, chores, chorechange, scheduler, proposals, disputes, corrections, descriptions, password, weekplan, plantable, planmeeting, planmeetinglive, suggestions, demo)`,
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
      weekplan: { ...NO_FEATURES, recurring: true, log: true, weekPlan: true },
      plantable: { ...NO_FEATURES, recurring: true, week: true, weekPlan: true },
      planmeeting: {
        ...NO_FEATURES,
        recurring: true,
        week: true,
        meeting: true,
        weekPlan: true,
        settleLastDay: true,
      },
      planmeetinglive: {
        ...NO_FEATURES,
        recurring: true,
        week: true,
        meeting: true,
        weekPlan: true,
        settleLastDay: true,
        liveChanges: true,
      },
      suggestions: { ...NO_FEATURES, suggestions: true },
      demo: ALL_FEATURES,
    }
    for (const name of Object.keys(SEEDS) as SeedName[]) {
      const db = createTestDb()
      seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: name }, T0)
      expect(getFlags(db), name).toEqual(expected[name])
    }
  })

  // One test per seed: a single loop over every seed outgrew the 5 s budget on CI.
  it.each(Object.keys(SEEDS))(
    'seed %s: the family logs in and the audit log is in time order',
    async (name) => {
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
    },
  )

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
      suggestions: false,
      liveChanges: false,
    })
  })
})

describe('suggestions piece (#247)', () => {
  const rows = (seed: SeedName) => {
    const db = createTestDb()
    seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: seed }, T0)
    const byId = new Map(
      db
        .select()
        .from(users)
        .all()
        .map((u) => [u.id, u.username]),
    )
    const list = db
      .select()
      .from(suggestions)
      .orderBy(asc(suggestions.id))
      .all()
      .map((s) => ({ by: byId.get(s.authorId), title: s.title, status: s.status }))
    return { db, list }
  }
  const expected = [
    { by: 'starsi', title: 'Tmavý režim i na obrazovce Týden', status: 'new' },
    { by: 'mladsi', title: 'Zvuk, když dokončím úkol', status: 'new' },
    { by: 'tata', title: 'Připomenout v neděli schůzku', status: 'done' },
    { by: 'starsi', title: 'Víc bodů za vynesení koše', status: 'dismissed' },
  ]

  it('the suggestions seed: two new, one done, one dismissed, and the switch on', () => {
    const { db, list } = rows('suggestions')
    expect(list).toEqual(expected)
    expect(getFlags(db).suggestions).toBe(true)
  })

  it('demo has them too', () => {
    expect(rows('demo').list).toEqual(expected)
  })
})
