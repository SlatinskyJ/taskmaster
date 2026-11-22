import { verify } from '@node-rs/argon2'
import { asc, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { login } from '~/server/auth'
import { auditLog, settlements, tasks, templates, templateThread, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { takerPoints } from '~/server/points'
import { listTasks } from '~/server/tasks'
import { bootstrapAdmin } from '~/server/users'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import { listPeriods, rollPeriods } from '~/server/periods'
import { rejectionsSince } from '~/server/tasks/rejections'
import { getMeeting } from '~/server/settlement/meeting'
import { ALL_FEATURES, NO_FEATURES } from '~/lib/features'
import { getFlags } from '~/server/features'
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
    const taskLog = db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityType, 'task'))
      .orderBy(asc(auditLog.id))
      .all()
    const done = [
      'task.created',
      'task.score_approved',
      'task.agreed',
      'task.reserved',
      'task.completed',
    ]
    expect(taskLog.map((r) => [r.action, r.actorKind])).toEqual([
      // #45's past week: three approved chores, then this week's rejected one.
      ...[
        ...[...done, 'task.approved'],
        ...[...done, 'task.approved'],
        ...[...done, 'task.approved'],
        ...[...done, 'task.rejected'],
      ].map((action) => [action, 'user']),
      ['task.created', 'user'],
      ['task.bid_placed', 'user'],
      ['task.bid_placed', 'user'],
      ['task.created', 'user'],
      ['task.created', 'user'],
      ['task.bid_placed', 'user'],
      ['task.score_approved', 'user'],
      ['task.agreed', 'user'],
      ['task.created', 'user'],
      ['task.score_approved', 'user'],
      ['task.agreed', 'user'],
      ['task.score_change_proposed', 'user'],
      ['task.created', 'user'],
      ['task.score_approved', 'user'],
      ['task.agreed', 'user'],
      ['task.cancelled', 'user'],
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
      // #44's week: six approved chores, then one pending completion per boy.
      ...[...Array<boolean>(6).fill(true), false, false].flatMap((approved) =>
        [
          'task.created',
          'task.score_approved',
          'task.agreed',
          'task.reserved',
          'task.completed',
          ...(approved ? ['task.approved'] : []),
        ].map((action) => [action, 'user']),
      ),
    ])
  })

  it('seeds a task in negotiation, a plain offer and one reserved to Starší, through the real actions', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    // The offers; #44's done chores are checked in their own test below.
    const all = listTasks(db).filter((t) => t.status === 'proposed' || t.status === 'reserved')
    expect(
      all.map((t) => [t.title, t.status, t.score, t.bids.map((b) => [b.name, b.score])]),
    ).toEqual([
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
      // Rejected (#45), so back to Mladší's reservation.
      ['Vynést sklo a plasty do kontejneru', 'reserved', 4, []],
    ])
    expect(all.find((t) => t.title.startsWith('Vyluxovat'))?.reservedBy?.name).toBe('Starší')
    // #36: Táta's new price 12 waits for the brothers; the cancelled task keeps its reason.
    expect(
      listTasks(db).find((t) => t.title === 'Shrabat listí na zahradě')?.scoreChange,
    ).toMatchObject({
      score: 12,
      waitingFor: [{ name: 'Starší' }, { name: 'Mladší' }],
    })
    const cancelled = db.select().from(auditLog).where(eq(auditLog.action, 'task.cancelled')).get()
    expect(cancelled?.reason).toBe('Udělá to firma.')
  })

  it('gives both brothers points (#40 + #44 week): confirmed and waiting, plus an open task', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    expect(takerPoints(db).takers.map((t) => [t.name, t.confirmed, t.pending])).toEqual([
      ['Starší', 260, 14],
      ['Mladší', 152, 3],
    ])
    const open = listTasks(db).filter((t) => t.status === 'open')
    expect(open.map((t) => [t.title, t.score])).toEqual([
      ['Umýt okna v obýváku i v ložnici', 5],
      ['Shrabat listí na zahradě', 10],
    ])
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

  it('turns every launch switch on, so a preview shows the whole app (prod stays off)', () => {
    const db = createTestDb()
    expect(getFlags(db)).toEqual(NO_FEATURES)
    seedDemo(db, PREVIEW, T0)
    expect(getFlags(db)).toEqual(ALL_FEATURES)
  })

  it('leaves the switches alone when it does not seed', () => {
    const db = createTestDb()
    seedDemo(db, { NODE_ENV: 'production' }, T0)
    expect(getFlags(db)).toEqual(NO_FEATURES)
  })

  it('a later boot of a seeded preview keeps a switch someone turned off', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    db.run(sql`UPDATE feature_flags SET enabled = 0 WHERE key = 'week'`)
    expect(seedDemo(db, PREVIEW, T0)).toEqual({ kind: 'skipped', reason: 'not_empty' })
    expect(getFlags(db)).toEqual({ ...ALL_FEATURES, week: false })
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

  it('demo seed gives a meeting with 3 pending items and totals 160 / 102 (#40 + #44, #45 carry 8)', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    // The roller starts the week at boot, right after the seed.
    rollPeriods(db, new Date(T0.getTime() + 60_000), DEFAULT_PERIOD_DEFAULTS)
    const meeting = getMeeting(db, new Date(T0.getTime() + 120_000))
    if (!meeting.period) throw new Error('no meeting')
    expect(meeting.pending.map((t) => [t.title, t.score, t.completedBy?.name])).toEqual([
      ['Vytřít podlahu v kuchyni', 12, 'Starší'],
      ['Zalít kytky', 2, 'Starší'],
      ['Vynést tříděný', 3, 'Mladší'],
    ])
    expect(meeting.takers.map((t) => [t.name, t.total])).toEqual([
      ['Starší', 160],
      ['Mladší', 102],
    ])
  })

  it('a settled past week (#45): records, the current week from the settle, one rejection', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    const [past, current] = listPeriods(db)
    if (!past || !current) throw new Error('no weeks')
    expect(past.startsAt).toEqual(new Date(T0.getTime() - 7 * 86_400_000))
    expect(current.startsAt).toEqual(past.endedAt)
    expect(listPeriods(db)).toHaveLength(2)
    const name = (id: number) => db.select().from(users).where(eq(users.id, id)).get()?.username
    expect(
      db
        .select()
        .from(settlements)
        .all()
        .map((r) => [r.periodId, name(r.takerId), r.totalBefore, r.level, r.deducted, r.carryOver]),
    ).toEqual([
      [past.id, 'starsi', 108, 'upper', 100, 8],
      [past.id, 'mladsi', 50, 'lower', 50, 0],
    ])
    expect(
      rejectionsSince(db, current.startsAt).map((r) => [
        r.title,
        r.score,
        name(r.earnerId),
        r.reason,
      ]),
    ).toEqual([
      [
        'Vynést sklo a plasty do kontejneru',
        4,
        'mladsi',
        'Sklo zůstalo v tašce u dveří, vynes ho prosím až dolů do kontejneru.',
      ],
    ])
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
    expect(describeDemo({ kind: 'seeded', usernames: ['admin'] })).toContain(DEMO_PASSWORD)
  })
})
