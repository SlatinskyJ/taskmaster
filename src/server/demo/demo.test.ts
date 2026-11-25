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
import { listTasks } from '~/server/tasks'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import { fromPragueWallTime } from '~/domain/dates'
import { listPeriods, proposalsView, rollPeriods } from '~/server/periods'
import { rejectionsSince } from '~/server/tasks/rejections'
import { getMeeting } from '~/server/settlement/meeting'
import { ALL_FEATURES } from '~/lib/features'
import { getFlags } from '~/server/features'
import { CORRECTION_REASON } from './pieces'
import { DEMO_PASSWORD, seedDemo } from './seed'

const T0 = new Date('2026-11-17T10:00:00.000Z')
const PREVIEW = { TASKMASTER_ENV: 'preview', NODE_ENV: 'production' }

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
    ])
  })

  it('every demo task by title and state (#183)', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    expect(
      listTasks(db)
        .map((t) => [t.title, t.status])
        .sort(),
    ).toEqual([
      ['Nachystat tašku do školy', 'open'], // #38 + Teď
      ['Nakrmit kočku', 'confirmed'], // #45 past week
      ['Nakrmit rybičky', 'expired'], // #39 tick in the past week
      ['Nakrmit rybičky', 'open'], // #39 boot tick
      ['Posekat trávu', 'confirmed'], // #44 week
      ['Pověsit prádlo', 'confirmed'], // #40
      ['Shrabat listí na zahradě', 'open'], // #36 price change
      ['Uklidit garáž', 'confirmed'], // #45
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

  it('gives both brothers points (#40 + #44 week, minus #45 settlement): confirmed and waiting, plus an open task', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    // Last week's settlement took 100 from Starší and 50 from Mladší (#172): the meeting's totals.
    expect(takerPoints(db, T0).takers.map((t) => [t.name, t.confirmed, t.pending])).toEqual([
      ['Starší', 165, 14],
      ['Mladší', 152, 6],
    ])
    const open = listTasks(db).filter((t) => t.status === 'open')
    expect(open.map((t) => [t.title, t.score])).toEqual([
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

  it('adds seven templates (#37, #38, #39, #209): three waiting for agreement, four agreed', () => {
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
    ])
    const actions = db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityType, 'template'))
      .all()
      .map((r) => r.action)
    expect(actions).toEqual([
      // By template (the entity index): #39's water and fish, the bins, the dishwasher, then
      // the school bag.
      ...['template.created', 'template.score_approved', 'template.agreed'],
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
    ])
    expect(
      db
        .select()
        .from(templates)
        .all()
        .map((t) => t.score),
    ).toEqual([1, 1, 4, 3, 2, 10, 4])
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
        .filter((d) => d.itemKind !== 'completion')
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
