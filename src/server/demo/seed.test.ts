import { verify } from '@node-rs/argon2'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { login } from '~/server/auth'
import { auditLog, templates, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { bootstrapAdmin } from '~/server/users'
import { DEMO_PASSWORD, describeDemo, seedDemo } from './seed'

const T0 = new Date('2026-11-17T10:00:00.000Z')
const PREVIEW = { TASKMASTER_ENV: 'preview', NODE_ENV: 'production' }

describe('demo seed (#62)', () => {
  it('fills an empty preview database with one person per role, audit-logged', async () => {
    const db = createTestDb()
    expect(seedDemo(db, PREVIEW, T0)).toEqual({
      kind: 'seeded',
      usernames: ['admin', 'tata', 'starsi', 'mladsi'],
    })
    const rows = db.select().from(users).all()
    expect(rows.map((u) => [u.username, u.role, u.active])).toEqual([
      ['admin', 'admin', true],
      ['tata', 'giver', true],
      ['starsi', 'taker', true],
      ['mladsi', 'taker', true],
    ])
    expect(await verify(rows[0]?.passwordHash ?? '', DEMO_PASSWORD)).toBe(true)
    const log = db.select().from(auditLog).where(eq(auditLog.entityType, 'user')).all()
    expect(log.map((r) => [r.action, r.actorKind])).toEqual(
      Array(4).fill(['user.created', 'system']),
    )
  })

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
    db.run(sql`DROP TRIGGER boom`)
    expect(seedDemo(db, PREVIEW, T0).kind).toBe('seeded')
    expect(db.select().from(users).all()).toHaveLength(4)
  })

  it('adds two templates (#37): one waiting for agreement, one agreed', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    expect(
      db
        .select({
          title: templates.title,
          status: templates.status,
          score: templates.score,
          days: templates.scheduleDays,
          time: templates.scheduleTime,
          due: templates.dueTime,
        })
        .from(templates)
        .all(),
    ).toEqual([
      {
        title: 'Vynést koše',
        status: 'proposed',
        score: 4,
        days: 1 << 2,
        time: '18:00',
        due: '07:00',
      },
      { title: 'Vyndat myčku', status: 'active', score: 3, days: 0, time: null, due: null },
    ])
    const actions = db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityType, 'template'))
      .all()
      .map((r) => r.action)
    expect(actions).toEqual([
      'template.created',
      'template.created',
      'template.score_approved',
      'template.agreed',
    ])
  })

  it('all or nothing: a failing template leaves no people either', () => {
    const db = createTestDb()
    db.run(
      sql`CREATE TRIGGER boom BEFORE INSERT ON templates WHEN NEW.title = 'Vyndat myčku' BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    )
    expect(() => seedDemo(db, PREVIEW, T0)).toThrow('boom')
    expect(db.select().from(users).all()).toHaveLength(0)
    expect(db.select().from(templates).all()).toHaveLength(0)
    expect(db.select().from(auditLog).all()).toHaveLength(0)
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
    expect(describeDemo({ kind: 'seeded', usernames: ['admin'] })).toContain(DEMO_PASSWORD)
  })
})
