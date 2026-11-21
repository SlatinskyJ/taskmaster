import { verify } from '@node-rs/argon2'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { login } from '~/server/auth'
import { auditLog, tasks, templates, templateThread, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { takerPoints } from '~/server/points'
import { listTasks } from '~/server/tasks'
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
    const taskLog = db.select().from(auditLog).where(eq(auditLog.entityType, 'task')).all()
    expect(taskLog.map((r) => [r.action, r.actorKind])).toEqual([
      ['task.created', 'user'],
      ['task.bid_placed', 'user'],
      ['task.bid_placed', 'user'],
      ['task.created', 'user'],
      ['task.created', 'user'],
      ['task.bid_placed', 'user'],
      ['task.score_approved', 'user'],
      ['task.agreed', 'user'],
      // #40: five tasks done (four of them approved), one left open, each agreed on one yes.
      ...[true, true, false, true, true].flatMap((approved) => [
        ['task.created', 'user'],
        ['task.score_approved', 'user'],
        ['task.agreed', 'user'],
        ['task.completed', 'user'],
        ...(approved ? [['task.approved', 'user']] : []),
      ]),
      ['task.created', 'user'],
      ['task.score_approved', 'user'],
      ['task.agreed', 'user'],
    ])
  })

  it('seeds a task in negotiation, a plain offer and one reserved to Starší, through the real actions', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    const all = listTasks(db)
    expect(
      all.map((t) => [t.title, t.status, t.score, t.bids.map((b) => [b.name, b.score])]),
    ).toEqual([
      ['Umýt okna v obýváku i v ložnici', 'open', 5, []],
      ['Pověsit prádlo', 'confirmed', 25, []],
      ['Umýt nádobí', 'confirmed', 30, []],
      ['Vytřít podlahu v kuchyni', 'done_unconfirmed', 12, []],
      ['Uklidit pokoj', 'confirmed', 25, []],
      ['Vynést tříděný odpad', 'confirmed', 15, []],
      ['Vyluxovat celý obývák a chodbu', 'reserved', 8, []],
      ['Uklidit sklep', 'proposed', 10, []],
      [
        'Umýt auto',
        'proposed',
        18,
        [
          ['Mladší', 22],
          ['Starší', 25],
        ],
      ],
    ])
    expect(all.find((t) => t.status === 'reserved')?.reservedBy?.name).toBe('Starší')
  })

  it('gives both brothers points (#40): Starší below spodní 50, Mladší past it, plus an open task', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    expect(takerPoints(db).takers.map((t) => [t.name, t.confirmed, t.pending])).toEqual([
      ['Starší', 40, 12],
      ['Mladší', 55, 0],
    ])
    const open = listTasks(db).filter((t) => t.status === 'open')
    expect(open.map((t) => [t.title, t.score])).toEqual([['Umýt okna v obýváku i v ložnici', 5]])
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
    expect(db.select().from(tasks).all()).toHaveLength(0)
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
      'template.bid_placed',
      'template.score_countered',
    ])
  })

  it('leaves a score change in flight on the dishwasher (#138): Mladší bids 5, Táta offers 4', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    const name = (id: number) => db.select().from(users).where(eq(users.id, id)).get()?.username
    const rows = db
      .select()
      .from(templateThread)
      .all()
      .map((r) => [name(r.userId), r.side, r.score, r.closedAs])
    expect(rows).toEqual([
      ['mladsi', 'taker', 5, null],
      ['tata', 'giver', 4, null],
    ])
    expect(
      db
        .select()
        .from(templates)
        .all()
        .map((t) => t.score),
    ).toEqual([4, 3])
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
