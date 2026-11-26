import { verify } from '@node-rs/argon2'
import { and, asc, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  auditLog,
  disputes,
  featureFlags,
  pointAdjustments,
  settlementCorrections,
  settlements,
  tasks,
  templates,
  templateThread,
  users,
} from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { takerPoints } from '~/server/points'
import { getTaskDetail, listTasks } from '~/server/tasks'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import { fromPragueWallTime } from '~/domain/dates'
import { listPeriods, proposalsView, rollPeriods } from '~/server/periods'
import { rejectionsSince } from '~/server/tasks/rejections'
import { getMeeting } from '~/server/settlement/meeting'
import { ALL_FEATURES } from '~/lib/features'
import { getFlags } from '~/server/features'
import { getWeekPlan } from '~/server/instances/weekPlan'
import { CHORE_DISPUTE_REASON, CORRECTION_REASON, PLAN_CHORES, WEEK_CHORES } from './pieces'
import { DEMO_PASSWORD, seedDemo } from './seed'

const T0 = new Date('2026-11-17T10:00:00.000Z')
const PREVIEW = { TASKMASTER_ENV: 'preview', NODE_ENV: 'production' }

/** A copy of the week plan's chores (#257) or the plan table's (#258), checked in their own tests below. */
const WEEK_TITLES = new Set([...WEEK_CHORES, ...PLAN_CHORES].map((c) => c.title))
const weekCopy = (t: { origin: string; title: string }) =>
  t.origin === 'scheduled' && WEEK_TITLES.has(t.title)

// What previews get (`demo`, the default seed, #183): the content of every piece in order.
describe('the demo seed (previews)', () => {
  it('fills an empty preview database with one person per role, audit-logged', async () => {
    const db = createTestDb()
    expect(seedDemo(db, PREVIEW, T0)).toEqual({
      kind: 'seeded',
      seed: 'demo',
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
      ].map((action) => [action, 'user']),
      // #39: a scheduler tick in the past week makes the water and the fish.
      ['instance.created', 'system'],
      ['instance.created', 'system'],
      ...[...done, 'task.rejected'].map((action) => [action, 'user']),
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
      // #212: the attic agreed after Starší's bid, reopened, Mladší bids; the terrace agreed.
      ['task.created', 'user'],
      ['task.bid_placed', 'user'],
      ['task.score_approved', 'user'],
      ['task.agreed', 'user'],
      ['task.bidding_reopened', 'user'],
      ['task.bid_placed', 'user'],
      ['task.created', 'user'],
      ['task.score_approved', 'user'],
      ['task.agreed', 'user'],
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
      // #38: Mladší's and Starší's Zapsat, Starší's rejected, then Táta's "+ Teď" on the bag.
      ['instance.self_logged', 'user'],
      ['instance.self_logged', 'user'],
      ['task.rejected', 'user'],
      ['instance.created', 'user'],
      // #39: the boot tick expires that fish and makes today's; the water is still open.
      ['instance.expired', 'system'],
      ['instance.created', 'system'],
      // #207: two tasks with a text; the open one gets Táta's new text, waiting.
      ['task.created', 'user'],
      ['task.created', 'user'],
      ['task.score_approved', 'user'],
      ['task.agreed', 'user'],
      ['task.description_change_proposed', 'user'],
      // #257: the week plan's copies, made by the system (counted in their own test).
      ...Array<string[]>(7).fill(['instance.created', 'system']),
      // #258: the plan table's copies (system), then Starší holds tomorrow's vacuum.
      ...Array<string[]>(17).fill(['instance.created', 'system']),
      ['task.reserved', 'user'],
    ])
  })

  it('every demo task by title and state (#183)', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    expect(
      listTasks(db)
        .filter((t) => !weekCopy(t))
        .map((t) => [t.title, t.status])
        .sort(),
    ).toEqual([
      ['Nachystat tašku do školy', 'open'], // #38 + Teď
      ['Nakrmit kočku', 'confirmed'], // #45 past week
      ['Nakrmit rybičky', 'expired'], // #39 tick in the past week
      ['Nakrmit rybičky', 'open'], // #39 boot tick
      ['Odnést krabice do sklepa', 'open'], // #207
      ['Posekat trávu', 'confirmed'], // #44 week
      ['Pověsit prádlo', 'confirmed'], // #40
      ['Shrabat listí na zahradě', 'open'], // #36 price change
      ['Uklidit garáž', 'confirmed'], // #45
      ['Uklidit kolárnu', 'proposed'], // #207
      ['Uklidit koupelnu', 'confirmed'], // #44
      ['Uklidit pokoj po návštěvě', 'confirmed'], // #44, Mladší
      ['Uklidit pokoj', 'confirmed'], // #40, Starší
      ['Uklidit sklep', 'proposed'], // #34
      ['Umýt auto', 'proposed'], // #34
      ['Umýt nádobí', 'confirmed'], // #40
      ['Umýt okna v kuchyni', 'cancelled'], // #36
      ['Umýt okna v obýváku i v ložnici', 'open'], // #40
      ['Vyluxovat celý obývák a chodbu', 'reserved'], // #150
      ['Vyměnit kočce vodu', 'open'], // #39
      ['Vyndat myčku', 'done_unconfirmed'], // #38 Zapsat, Mladší
      ['Vyndat myčku', 'rejected'], // #38 Zapsat, Starší
      ['Vynést papír', 'confirmed'], // #44
      ['Vynést sklo a plasty do kontejneru', 'reserved'], // #45, rejected
      ['Vynést staré věci na půdu', 'open'], // #212, in a round
      ['Vynést tříděný odpad', 'confirmed'], // #40
      ['Vynést tříděný', 'done_unconfirmed'], // #44
      ['Vysát auto', 'confirmed'], // #44
      ['Vytřít podlahu v kuchyni', 'done_unconfirmed'], // #40
      ['Vytřít podlahu', 'confirmed'], // #45
      ['Zalít kytky', 'done_unconfirmed'], // #44
      ['Zamést chodník před domem', 'open'], // #212
      ['Zamést terasu', 'confirmed'], // #44
    ])
  })

  it('seeds a task in negotiation, a plain offer and one reserved to Starší, through the real actions', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    // The offers; #44's done chores are checked in their own test below.
    const all = listTasks(db).filter(
      (t) => (t.status === 'proposed' || t.status === 'reserved') && !weekCopy(t),
    )
    expect(
      all.map((t) => [t.title, t.status, t.score, t.bids.map((b) => [b.name, b.score])]),
    ).toEqual([
      ['Uklidit kolárnu', 'proposed', 14, []], // #207, with a text
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

  it('gives both brothers points (#40 + #44 week, minus #45 settlement): confirmed and waiting, plus an open task', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    // Last week's settlement took 100 from Starší and 50 from Mladší (#172): the meeting's totals.
    expect(takerPoints(db, T0).takers.map((t) => [t.name, t.confirmed, t.pending])).toEqual([
      ['Starší', 165, 14],
      ['Mladší', 152, 6],
    ])
    const open = listTasks(db).filter((t) => t.status === 'open' && !weekCopy(t))
    expect(open.map((t) => [t.title, t.score])).toEqual([
      ['Odnést krabice do sklepa', 8], // #207, a new text waiting
      ['Nakrmit rybičky', 1], // #39 boot tick
      ['Nachystat tašku do školy', 2], // #38 + Teď
      ['Umýt okna v obýváku i v ložnici', 5],
      ['Zamést chodník před domem', 6], // #212, never reopened
      ['Vynést staré věci na půdu', 12], // #212, in a round
      ['Shrabat listí na zahradě', 10],
      ['Vyměnit kočce vodu', 1], // #39
    ])
  })

  it('turns every launch switch on, so a preview shows the whole app', () => {
    const db = createTestDb()
    db.update(featureFlags).set({ enabled: false }).run()
    seedDemo(db, PREVIEW, T0)
    expect(getFlags(db)).toEqual(ALL_FEATURES)
  })

  it('a later boot of a seeded preview keeps a switch someone turned off', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    db.run(sql`UPDATE feature_flags SET enabled = 0 WHERE key = 'week'`)
    expect(seedDemo(db, PREVIEW, T0)).toEqual({ kind: 'skipped', reason: 'not_empty' })
    expect(getFlags(db)).toEqual({ ...ALL_FEATURES, week: false })
  })

  it('adds fifteen templates (#37, #38, #39, #209, #232, #207, #257, #258): three waiting for agreement, twelve agreed', () => {
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
      // #39's everyday templates, made in the past week.
      {
        title: 'Vyměnit kočce vodu',
        status: 'active',
        score: 1,
        days: 127,
        time: '07:00',
        due: null,
      },
      {
        title: 'Nakrmit rybičky',
        status: 'active',
        score: 1,
        days: 127,
        time: '18:00',
        due: '18:00',
      },
      {
        title: 'Vynést koše',
        status: 'proposed',
        score: 4,
        days: 1 << 2,
        time: '18:00',
        due: '07:00',
      },
      { title: 'Vyndat myčku', status: 'active', score: 3, days: 0, time: null, due: null },
      {
        title: 'Nachystat tašku do školy',
        status: 'active',
        score: 2,
        days: 0,
        time: null,
        due: '07:00',
      },
      // #209's proposed chores, open for bids.
      { title: 'Vynést kompost', status: 'proposed', score: 10, days: 0, time: null, due: null },
      { title: 'Zalít kytky', status: 'proposed', score: 4, days: 0, time: null, due: null },
      // #232's agreed chore with a price change of two bids.
      { title: 'Umýt koupelnu', status: 'active', score: 8, days: 0, time: null, due: null },
      // #207's agreed chore with a text.
      { title: 'Utřít prach v pokoji', status: 'active', score: 4, days: 0, time: null, due: null },
      // #257's week-plan chores.
      { title: 'Nakrmit kočku', status: 'active', score: 3, days: 127, time: null, due: null },
      {
        title: 'Vynést tříděný odpad',
        status: 'active',
        score: 4,
        days: (1 << 2) | (1 << 5),
        time: '18:00',
        due: '07:00',
      },
      // #258's plan-table chores.
      {
        title: 'Vyluxovat celý obývák a chodbu',
        status: 'active',
        score: 6,
        days: 127,
        time: null,
        due: null,
      },
      {
        title: 'Prostřít stůl k večeři',
        status: 'active',
        score: 2,
        days: 127,
        time: null,
        due: null,
      },
      {
        title: 'Zalít kytky na balkoně',
        status: 'active',
        score: 3,
        days: 127,
        time: null,
        due: null,
      },
      {
        title: 'Vynést koš na plasty',
        status: 'active',
        score: 4,
        days: (1 << 2) | (1 << 5),
        time: '18:00',
        due: '07:00',
      },
    ])
    const actions = db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityType, 'template'))
      .all()
      .map((r) => r.action)
    expect(actions).toEqual([
      // By template (the entity index, ids as text: 1, 10, 11, 12, …, 15, 2, …): #39's water,
      // #257's cat and sorted waste, #258's four chores, #39's fish, the bins, the dishwasher,
      // then the school bag.
      ...['template.created', 'template.score_approved', 'template.agreed'],
      ...['template.created', 'template.score_approved', 'template.agreed'],
      ...['template.created', 'template.score_approved', 'template.agreed'],
      ...Array.from({ length: 4 }, () => [
        'template.created',
        'template.score_approved',
        'template.agreed',
      ]).flat(),
      ...['template.created', 'template.score_approved', 'template.agreed'],
      'template.created',
      'template.created',
      'template.score_approved',
      'template.agreed',
      'template.bid_placed',
      'template.score_countered',
      'template.created',
      'template.score_approved',
      'template.agreed',
      'template.created',
      ...['template.created', 'template.bid_placed', 'template.bid_placed'],
      ...['template.created', 'template.score_approved', 'template.agreed'],
      ...['template.bid_placed', 'template.bid_placed'],
      ...['template.created', 'template.score_approved', 'template.agreed'],
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
      // #209: the bids on "Zalít kytky".
      ['starsi', 'taker', 6, null],
      ['mladsi', 'taker', 7, null],
      // #232: the price change on "Umýt koupelnu".
      ['starsi', 'taker', 10, null],
      ['mladsi', 'taker', 11, null],
    ])
    expect(
      db
        .select()
        .from(templates)
        .all()
        .map((t) => t.score),
    ).toEqual([1, 1, 4, 3, 2, 10, 4, 8, 4, 3, 4, 6, 2, 3, 4])
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

  it('demo seed gives a meeting with 4 pending items and totals 165 / 152 (#40 + #44, #45 carry 8, #48 fixes)', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    // The roller starts the week at boot, right after the seed.
    rollPeriods(db, new Date(T0.getTime() + 60_000), DEFAULT_PERIOD_DEFAULTS)
    const meeting = getMeeting(db, new Date(T0.getTime() + 120_000), false)
    if (!meeting.period) throw new Error('no meeting')
    expect(meeting.pending.map((t) => [t.title, t.score, t.completedBy?.name])).toEqual([
      ['Vytřít podlahu v kuchyni', 12, 'Starší'],
      ['Zalít kytky', 2, 'Starší'],
      ['Vynést tříděný', 3, 'Mladší'],
      ['Vyndat myčku', 3, 'Mladší'], // #38 Zapsat
    ])
    expect(meeting.takers.map((t) => [t.name, t.total])).toEqual([
      ['Starší', 165],
      ['Mladší', 152],
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
      // #38: Starší's Zapsat, rejected without a reason.
      ['Vyndat myčku', 3, 'starsi', null],
      [
        'Vynést sklo a plasty do kontejneru',
        4,
        'mladsi',
        'Sklo zůstalo v tašce u dveří, vynes ho prosím až dolů do kontejneru.',
      ],
    ])
  })

  // Previews seed with the real clock: every weekday, morning and evening, gives the same rows.
  const NOWS = [16, 17, 18, 19, 20, 21, 22].flatMap((day) =>
    [8, 20].map((hour) => fromPragueWallTime({ year: 2026, month: 11, day, hour, minute: 0 })),
  )
  it.each(
    NOWS.flatMap((now) => (['demo', 'scheduler'] as const).map((seed) => [seed, now] as const)),
  )(
    "scheduled rows (#39), seed %s at %s: water open, today's fish open, an expired fish",
    (seed, now) => {
      const db = createTestDb()
      seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: seed }, now)
      const rows = db
        .select()
        .from(tasks)
        .where(eq(tasks.origin, 'scheduled'))
        .orderBy(asc(tasks.id))
        .all()
        .filter((r) => !weekCopy(r))
      expect(rows.map((r) => [r.title, r.status, r.dueAt !== null])).toEqual([
        ['Vyměnit kočce vodu', 'open', false],
        ['Nakrmit rybičky', 'expired', true],
        ['Nakrmit rybičky', 'open', true],
      ])
      const [, , fish] = rows
      expect(new Date(fish?.graceEndsAt ?? 0).getTime()).toBeGreaterThan(now.getTime())
      const expired = db
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.action, 'instance.expired'), eq(auditLog.entityId, String(rows[1]?.id))),
        )
        .all()
      expect(expired.map((e) => e.actorKind)).toEqual(['system'])
      const at = db
        .select({ at: auditLog.at })
        .from(auditLog)
        .orderBy(asc(auditLog.id))
        .all()
        .map((r) => r.at)
      expect(at).toEqual([...at].sort())
    },
  )

  it('the scheduler seed: the expired fish is task 5 (e2e opens /ukol/5)', () => {
    const db = createTestDb()
    seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: 'scheduler' }, T0)
    const fish = db.select().from(tasks).where(eq(tasks.id, 5)).get()
    expect([fish?.title, fish?.status]).toEqual(['Nakrmit rybičky', 'expired'])
  })
})

describe('the demo seed: proposals (#43)', () => {
  it('a pending next week (waits for Mladší) and a pending default week (waits for both)', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    const name = (uid: number) => db.select().from(users).where(eq(users.id, uid)).get()?.username
    const v = proposalsView(db, T0)
    expect(v.period?.status).toBe('pending')
    expect(v.period?.waitingFor.map(name)).toEqual(['mladsi'])
    expect(v.defaults?.status).toBe('pending')
    expect(v.defaults?.waitingFor.map(name)).toEqual(['starsi', 'mladsi'])
  })
})

describe('the demo seed: disputes (#46)', () => {
  it.each(['demo', 'disputes'])(
    '%s: Starší disputes "Vysát auto"; Mladší\'s settlement dispute is dismissed',
    (seed) => {
      const db = createTestDb()
      seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: seed }, T0)
      const name = (uid: number | null) =>
        uid === null ? null : db.select().from(users).where(eq(users.id, uid)).get()?.username
      // The corrections piece (#48) runs later in `demo` and opens two more: not this piece's.
      const rows = db.select().from(disputes).orderBy(asc(disputes.id)).all().slice(0, 2)
      expect(
        rows.map((d) => [d.itemKind, name(d.openedBy), d.status, name(d.resolvedBy), d.note]),
      ).toEqual([
        ['completion', 'starsi', 'open', null, null],
        ['settlement', 'mladsi', 'dismissed', 'admin', 'Body sedí, zkontroloval jsem to s tátou.'],
      ])
      const car = db
        .select()
        .from(tasks)
        .where(eq(tasks.id, rows[0]?.itemId ?? 0))
        .get()
      expect(car?.title).toBe('Vysát auto')
      const record = db
        .select()
        .from(settlements)
        .where(eq(settlements.id, rows[1]?.itemId ?? 0))
        .get()
      expect(name(record?.takerId ?? null)).toBe('mladsi')
      const log = db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityType, 'dispute'))
        .orderBy(asc(auditLog.id))
        .all()
        .filter((e) => rows.some((d) => String(d.id) === e.entityId))
      expect(log.map((e) => [e.action, e.entityId])).toEqual([
        ['dispute.opened', String(rows[0]?.id)],
        ['dispute.opened', String(rows[1]?.id)],
        ['dispute.dismissed', String(rows[1]?.id)],
      ])
      expect(JSON.parse(log[2]?.after ?? 'null')).toEqual({
        status: 'dismissed',
        note: 'Body sedí, zkontroloval jsem to s tátou.',
        value: { level: 'lower', deducted: 50 },
      })
      expect(JSON.parse(log[2]?.before ?? 'null')).toEqual({ status: 'open' })
      expect(getFlags(db).disputes).toBe(true)
    },
  )
})

describe('the demo seed: corrections (#48)', () => {
  it.each(['demo', 'corrections'])(
    "%s: a manual +5 for Starší he disputes; Mladší's past week corrected to none, he disputes it",
    (seed) => {
      const db = createTestDb()
      seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: seed }, T0)
      const name = (uid: number) => db.select().from(users).where(eq(users.id, uid)).get()?.username
      const corrections = db.select().from(settlementCorrections).all()
      expect(corrections.map((c) => [c.level, c.deducted, c.reason, c.disputeId])).toEqual([
        ['none', 0, CORRECTION_REASON, null],
      ])
      const record = db
        .select()
        .from(settlements)
        .where(eq(settlements.id, corrections[0]?.settlementId ?? 0))
        .get()
      expect(name(record?.takerId ?? 0)).toBe('mladsi')
      const adjustments = db.select().from(pointAdjustments).orderBy(asc(pointAdjustments.id)).all()
      expect(
        adjustments.map((a) => [
          name(a.takerId),
          a.points,
          a.correctionId === null ? 'manual' : 'correction',
        ]),
      ).toEqual([
        ['starsi', 5, 'manual'],
        ['mladsi', 50, 'correction'],
      ])
      const open = db
        .select()
        .from(disputes)
        .where(eq(disputes.status, 'open'))
        .orderBy(asc(disputes.id))
        .all()
        // Not the completions (the disputes piece) nor the chore score (choreDispute, #222).
        .filter((d) => d.itemKind !== 'completion' && d.itemKind !== 'template_score')
      expect(open.map((d) => [d.itemKind, d.itemId, name(d.openedBy)])).toEqual([
        ['settlement', record?.id, 'mladsi'],
        ['adjustment', adjustments[0]?.id, 'starsi'],
      ])
      const actions = db
        .select()
        .from(auditLog)
        .all()
        .map((e) => e.action)
      expect(actions).toEqual(expect.arrayContaining(['points.adjusted', 'settlement.corrected']))
    },
  )
})

describe('the demo seed: a chore in dispute (#222)', () => {
  it.each(['demo', 'disputes'])('%s: Mladší disputes the agreed "Vyndat myčku", open', (seed) => {
    const db = createTestDb()
    seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: seed }, T0)
    const rows = db.select().from(disputes).where(eq(disputes.itemKind, 'template_score')).all()
    expect(rows.map((d) => [d.status, d.reason])).toEqual([['open', CHORE_DISPUTE_REASON]])
    const chore = db
      .select()
      .from(templates)
      .where(eq(templates.id, rows[0]?.itemId ?? 0))
      .get()
    expect([chore?.title, chore?.status]).toEqual(['Vyndat myčku', 'active'])
    const mladsi = db.select().from(users).where(eq(users.username, 'mladsi')).get()
    expect(rows[0]?.openedBy).toBe(mladsi?.id)
  })
})

describe('the demo seed: descriptions (#207)', () => {
  it('a proposed task and an agreed chore with a text, an open task with a new text waiting', () => {
    const db = createTestDb()
    seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: 'descriptions' }, T0)
    const byTitle = (title: string) =>
      getTaskDetail(db, listTasks(db).find((t) => t.title === title)?.id ?? 0, {
        descriptions: true,
      })
    expect(byTitle('Uklidit kolárnu')?.task).toMatchObject({
      status: 'proposed',
      description: 'Zamést celou podlahu.\nKola pověsit na háky.',
    })
    const boxes = byTitle('Odnést krabice do sklepa')
    expect(boxes?.task).toMatchObject({ status: 'open', description: 'Všechny krabice z chodby.' })
    expect(boxes?.descriptionChange).toMatchObject({
      description: 'Všechny krabice z chodby.\nPrázdné složit a dát k popelnicím.',
      waitingForNames: ['Starší', 'Mladší'],
    })
    const dust = db
      .select()
      .from(templates)
      .where(eq(templates.title, 'Utřít prach v pokoji'))
      .get()
    expect(dust).toMatchObject({
      status: 'active',
      description: 'Police, stůl i parapet. Hadr je pod dřezem.',
    })
  })
})

describe('the week plan (#257)', () => {
  it('demo at T0 (Tuesday 11:00): the two chores are agreed now, their copies start with the next slot and each has its Prague day', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    const day = (d: number) =>
      fromPragueWallTime({ year: 2026, month: 11, day: d, hour: 0, minute: 0 }).toISOString()
    const copies = db
      .select()
      .from(tasks)
      .orderBy(asc(tasks.id))
      .all()
      .filter((t) => weekCopy(t) && WEEK_CHORES.some((c) => c.title === t.title))
    expect(copies.map((r) => [r.title, r.planDayAt, r.status, r.weekRules])).toEqual([
      ...[18, 19, 20, 21, 22].map((d) => ['Nakrmit kočku', day(d), 'open', true]),
      ['Vynést tříděný odpad', day(17), 'open', true],
      ['Vynést tříděný odpad', day(20), 'open', true],
    ])
  })

  it.each([8, 23])(
    "the weekplan seed at %i:00: a week from today 00:00, today's cat copy open, the log in time order",
    (hour) => {
      const now = fromPragueWallTime({ year: 2026, month: 12, day: 2, hour, minute: 0 })
      const db = createTestDb()
      seedDemo(db, { ...PREVIEW, TASKMASTER_SEED: 'weekplan' }, now)
      const today = fromPragueWallTime({ year: 2026, month: 12, day: 2, hour: 0, minute: 0 })
      expect(listPeriods(db).map((p) => p.startsAt)).toEqual([today])
      const cat = db
        .select()
        .from(tasks)
        .orderBy(asc(tasks.id))
        .all()
        .filter((t) => t.title === 'Nakrmit kočku')
      expect(cat.map((t) => t.planDayAt)).toEqual(
        [2, 3, 4, 5, 6].map((d) =>
          fromPragueWallTime({ year: 2026, month: 12, day: d, hour: 0, minute: 0 }).toISOString(),
        ),
      )
      expect(cat.every((t) => t.status === 'open')).toBe(true)
      expect(getFlags(db).weekPlan).toBe(true)
      const at = db
        .select({ at: auditLog.at })
        .from(auditLog)
        .orderBy(asc(auditLog.id))
        .all()
        .map((r) => r.at)
      expect(at).toEqual([...at].sort())
    },
  )
})

describe('the plan table (#258)', () => {
  it("demo at T0: the plan table has the four #258 chores, agreed now, so today has none of their copies; Starší holds tomorrow's vacuum", () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    const plan = getWeekPlan(db, T0)
    const titles = new Set(PLAN_CHORES.map((c) => c.title))
    const rows = plan.rows.filter((r) => titles.has(r.title))
    expect(rows.map((r) => r.title)).toEqual([
      'Prostřít stůl k večeři',
      'Vyluxovat celý obývák a chodbu',
      'Vynést koš na plasty',
      'Zalít kytky na balkoně',
    ])
    const at = plan.days.indexOf(plan.today)
    // Tuesday 17. 11.: the bins' 18:00 slot is still ahead, the every-day chores start tomorrow.
    expect(rows.map((r) => r.cells[at]?.map((c) => c.status))).toEqual([[], [], ['open'], []])
    expect(rows[1]?.cells[at + 1]?.map((c) => [c.status, c.person?.name])).toEqual([
      ['reserved', 'Starší'],
    ])
  })
})
