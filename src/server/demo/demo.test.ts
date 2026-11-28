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
import { addPragueDays, fromPragueWallTime, startOfPragueDay } from '~/domain/dates'
import { listPeriods, proposalsView } from '~/server/periods'
import { rejectionsSince } from '~/server/tasks/rejections'
import { getMeeting } from '~/server/settlement/meeting'
import { ALL_FEATURES } from '~/lib/features'
import { getFlags } from '~/server/features'
import { getWeekPlan } from '~/server/instances/weekPlan'
import {
  CHORE_DISPUTE_REASON,
  CORRECTION_REASON,
  DEMO_CHORES,
  PLAN_CHORES,
  WEEK_CHORES,
} from './pieces'
import { DEMO_PASSWORD } from '~/lib/demoAccounts'
import { seedDemo } from './seed'

const T0 = new Date('2026-11-17T10:00:00.000Z')
const PREVIEW = { TASKMASTER_ENV: 'preview', NODE_ENV: 'production' }

/** A copy of the week plan's chores (#257) or the plan table's (#258), checked in their own tests below. */
const WEEK_TITLES = new Set([...WEEK_CHORES, ...PLAN_CHORES, ...DEMO_CHORES].map((c) => c.title))
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
    const user = (...actions: string[]) => actions.map((action) => [action, 'user'])
    const days = (n: number, approved = n) => [
      ...Array<string[]>(n).fill(['task.completed', 'user']),
      ...Array<string[]>(approved).fill(['task.approved', 'user']),
    ]
    expect(taskLog.map((r) => [r.action, r.actorKind])).toEqual([
      // #356's past week: three approved chores.
      ...user(...done, 'task.approved', ...done, 'task.approved', ...done, 'task.approved'),
      // The running week's plan copies, then its five past days (Thursday's table cancelled,
      // Starší's bed from yesterday waiting); then this week's rejected chore.
      ...Array<string[]>(26).fill(['instance.created', 'system']),
      ...days(3),
      ...days(4),
      ...days(3),
      ['task.cancelled', 'user'],
      ...days(2),
      ...days(2, 1),
      ...user(...done, 'task.rejected'),
      // #34, #150, #36, #212, #36's cancelled task.
      ...user('task.created', 'task.bid_placed', 'task.bid_placed'),
      ...user('task.created', 'task.created', 'task.bid_placed', 'task.score_approved'),
      ...user('task.agreed', 'task.created', 'task.score_approved', 'task.agreed'),
      ...user('task.score_change_proposed'),
      ...user('task.created', 'task.bid_placed', 'task.score_approved', 'task.agreed'),
      ...user('task.bidding_reopened', 'task.bid_placed'),
      ...user('task.created', 'task.score_approved', 'task.agreed'),
      ...user('task.created', 'task.score_approved', 'task.agreed', 'task.cancelled'),
      // #356's one-time work: two approved, two waiting, one agreed for Volné.
      ...user(...done, 'task.approved', ...done, 'task.approved', ...done, ...done),
      ...user('task.created', 'task.score_approved', 'task.agreed'),
      // #38: Mladší's and Starší's Zapsat, Starší's rejected, then Táta's "+ Teď" on the bag.
      ...user('instance.self_logged', 'instance.self_logged', 'task.rejected', 'instance.created'),
      // #207: two tasks with a text; the open one gets Táta's new text, waiting.
      ...user('task.created', 'task.created', 'task.score_approved', 'task.agreed'),
      ...user('task.description_change_proposed'),
      // #356's today: two held, the table set; the past days' leftovers expire.
      ...user('task.reserved', 'task.reserved', 'task.completed'),
      ...Array<string[]>(6).fill(['instance.expired', 'system']),
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
      ['Odnést krabice do sklepa', 'open'], // #207
      ['Shrabat listí na zahradě', 'open'], // #36 price change
      ['Uklidit garáž', 'confirmed'], // #356 past week
      ['Uklidit hračky', 'done_unconfirmed'], // #356, Starší
      ['Uklidit kolárnu', 'proposed'], // #207
      ['Uklidit sklep', 'proposed'], // #34
      ['Umýt auto', 'proposed'], // #34
      ['Umýt nádobí', 'confirmed'], // #356, Mladší
      ['Umýt okna v kuchyni', 'cancelled'], // #36
      ['Umýt okna v obýváku i v ložnici', 'open'], // #356, for Volné
      ['Vyluxovat celý obývák a chodbu', 'reserved'], // #150
      ['Vyndat myčku', 'done_unconfirmed'], // #38 Zapsat, Mladší
      ['Vyndat myčku', 'rejected'], // #38 Zapsat, Starší
      ['Vynést papír', 'done_unconfirmed'], // #356, Mladší
      ['Vynést sklo a plasty do kontejneru', 'reserved'], // #45, rejected
      ['Vynést staré věci na půdu', 'open'], // #212, in a round
      ['Vysát auto', 'confirmed'], // #356, disputed (#46)
      ['Vytřít podlahu', 'confirmed'], // #356 past week
      ['Vyčistit kočičí záchod', 'confirmed'], // #356 past week
      ['Zamést chodník před domem', 'open'], // #212
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
    const cancelled = db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'task.cancelled'))
      .all()
      .map((e) => e.reason)
    // #356's cancelled plan copy, then #36's task.
    expect(cancelled).toEqual(['Večeříme u babičky.', 'Udělá to firma.'])
  })

  it('gives the brothers different outcomes (#356): Starší below spodní even with all approved, Mladší between', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    // Starší: 5 carried + 5 by hand + 8 car + 18 plan; Mladší: 50 given back + 8 dishes + 21 plan.
    expect(takerPoints(db, T0).takers.map((t) => [t.name, t.confirmed, t.pending])).toEqual([
      ['Starší', 36, 8],
      ['Mladší', 79, 6],
    ])
    const open = listTasks(db).filter((t) => t.status === 'open' && !weekCopy(t))
    expect(open.map((t) => [t.title, t.score])).toEqual([
      ['Odnést krabice do sklepa', 8], // #207, a new text waiting
      ['Nachystat tašku do školy', 2], // #38 + Teď
      ['Umýt okna v obýváku i v ložnici', 5], // #356, for Volné
      ['Zamést chodník před domem', 6], // #212, never reopened
      ['Vynést staré věci na půdu', 12], // #212, in a round
      ['Shrabat listí na zahradě', 10],
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

  it('adds twelve templates (#356, #37, #38, #209, #232, #207): three waiting for agreement, nine agreed', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    const plan = (title: string, score: number) => ({
      title,
      status: 'active',
      score,
      days: 127,
      time: null,
      due: null,
    })
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
      // #356's week plan, agreed at the running week's start; the bed's price went 3 → 4.
      plan('Nakrmit kočku', 3),
      plan('Vyluxovat pokoj', 6),
      plan('Prostřít stůl k večeři', 2),
      plan('Ustlat postel', 4),
      {
        title: 'Vynést koš na plasty',
        status: 'active',
        score: 4,
        days: (1 << 2) | (1 << 5),
        time: '18:00',
        due: '07:00',
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
    ])
    const actions = db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityType, 'template'))
      .all()
      .map((r) => r.action)
    const agreed = ['template.created', 'template.score_approved', 'template.agreed']
    expect(actions).toEqual([
      // By template (the entity index, ids as text: 1, 10, 11, 12, 2, …): the cat, #209's two,
      // #232's bath, #207's dust, the vacuum, the table, the bed with its finished price change,
      // the plastics bin, #37's bins, the dishwasher, then the school bag.
      ...agreed,
      ...['template.created', 'template.bid_placed', 'template.bid_placed'],
      ...[...agreed, 'template.bid_placed', 'template.bid_placed'],
      ...agreed,
      ...agreed,
      ...agreed,
      ...[...agreed, 'template.bid_placed', 'template.bid_placed', 'template.score_changed'],
      ...agreed,
      'template.created',
      ...[...agreed, 'template.bid_placed', 'template.score_countered'],
      ...agreed,
      'template.created',
    ])
  })

  it('leaves a score change in flight on the dishwasher (#138) and a finished one on the bed (#356)', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    const name = (id: number) => db.select().from(users).where(eq(users.id, id)).get()?.username
    const rows = db
      .select()
      .from(templateThread)
      .all()
      .map((r) => [name(r.userId), r.side, r.score, r.closedAs])
    expect(rows).toEqual([
      // #356: "Ustlat postel", Mladší bids 5, Starší 4, Táta takes the lowest.
      ['mladsi', 'taker', 5, 'closed'],
      ['starsi', 'taker', 4, 'accepted'],
      // #138: the dishwasher, Mladší bids 5, Táta offers 4.
      ['mladsi', 'taker', 5, null],
      ['tata', 'giver', 4, null],
      // #209: the bids on "Zalít kytky".
      ['starsi', 'taker', 6, null],
      ['mladsi', 'taker', 7, null],
      // #232: the price change on "Umýt koupelnu".
      ['starsi', 'taker', 10, null],
      ['mladsi', 'taker', 11, null],
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

  it('demo seed gives a meeting with 5 pending items, Starší below spodní and Mladší between (#356)', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    const meeting = getMeeting(db, new Date(T0.getTime() + 120_000), true)
    if (!meeting.period) throw new Error('no meeting')
    expect(meeting.period.running).toBe(true)
    expect(meeting.pending.map((t) => [t.title, t.score, t.completedBy?.name])).toEqual([
      ['Ustlat postel', 3, 'Starší'], // yesterday's copy
      ['Prostřít stůl k večeři', 2, 'Starší'], // today's copy
      ['Uklidit hračky', 3, 'Starší'],
      ['Vynést papír', 3, 'Mladší'],
      ['Vyndat myčku', 3, 'Mladší'], // #38 Zapsat
    ])
    expect(meeting.takers.map((t) => [t.name, t.total, t.level])).toEqual([
      ['Starší', 36, 'none'],
      ['Mladší', 79, 'lower'],
    ])
  })

  it('a settled past week (#45): records, the running week from five days ago to tomorrow 00:00, one rejection', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    const [past, current] = listPeriods(db)
    if (!past || !current) throw new Error('no weeks')
    const day = (d: number) =>
      fromPragueWallTime({ year: 2026, month: 11, day: d, hour: 0, minute: 0 })
    expect(past.startsAt).toEqual(new Date(T0.getTime() - 7 * 86_400_000))
    expect([past.endedAt, current.startsAt, current.cutoffAt]).toEqual([day(12), day(12), day(18)])
    expect(listPeriods(db)).toHaveLength(2)
    const name = (id: number) => db.select().from(users).where(eq(users.id, id)).get()?.username
    expect(
      db
        .select()
        .from(settlements)
        .all()
        .map((r) => [r.periodId, name(r.takerId), r.totalBefore, r.level, r.deducted, r.carryOver]),
    ).toEqual([
      [past.id, 'starsi', 105, 'upper', 100, 5],
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
  it.each(NOWS.map((now) => ['scheduler', now] as const))(
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

describe('the demo week (#356)', () => {
  it('at T0 (Tuesday 11:00) the plan table has five past days and today in every state', () => {
    const db = createTestDb()
    seedDemo(db, PREVIEW, T0)
    const plan = getWeekPlan(db, T0)
    expect(plan.days).toHaveLength(6)
    expect(plan.today).toBe(plan.days[5])
    const cells = (title: string) =>
      plan.rows
        .find((r) => r.title === title)
        ?.cells.map((c) => c.map((x) => (x.person ? `${x.status} ${x.person.name}` : x.status)))
    const ok = 'confirmed Starší'
    expect(cells('Nakrmit kočku')).toEqual([
      ...Array<string[]>(5).fill(['confirmed Mladší']),
      ['open'],
    ])
    expect(cells('Vyluxovat pokoj')).toEqual([
      ['expired'],
      ['confirmed Mladší'],
      ['expired'],
      ['expired'],
      ['expired'],
      ['reserved Mladší'],
    ])
    expect(cells('Prostřít stůl k večeři')).toEqual([
      [ok],
      [ok],
      [ok],
      ['cancelled'],
      ['expired'],
      ['done_unconfirmed Starší'],
    ])
    expect(cells('Ustlat postel')).toEqual([
      [ok],
      [ok],
      [ok],
      [ok],
      ['done_unconfirmed Starší'],
      ['reserved Starší'],
    ])
    // Tuesday 17. 11. 18:00 is still ahead; Friday 13. 11. expired.
    expect(cells('Vynést koš na plasty')).toEqual([[], ['expired'], [], [], [], ['open']])
    const cancelled = db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'task.cancelled'), eq(auditLog.actorKind, 'user')))
      .all()
      .map((e) => e.reason)
    expect(cancelled).toEqual(['Večeříme u babičky.', 'Udělá to firma.'])
  })

  // The demo resets at 03:00 and redeploys at any hour: every weekday and hour gives a running
  // week that ends at tomorrow 00:00, settles at Schůzka until then and waits for it after.
  const DEMO_NOWS = [23, 24, 25, 26, 27, 28, 29].flatMap((day) =>
    [
      [0, 5],
      [3, 0],
      [12, 0],
      [23, 55],
    ].map(([hour = 0, minute = 0]) =>
      fromPragueWallTime({ year: 2026, month: 11, day, hour, minute }),
    ),
  )
  it.each(DEMO_NOWS)(
    'at %s: Schůzka can approve and settle until tomorrow 00:00 and after',
    (now) => {
      const db = createTestDb()
      seedDemo(db, PREVIEW, now)
      const tomorrow = addPragueDays(startOfPragueDay(now), 1)
      expect(listPeriods(db).map((p) => p.cutoffAt.getTime())).toContain(tomorrow.getTime())
      const before = getMeeting(db, new Date(now.getTime() + 60_000), true)
      expect(before.period?.running).toBe(true)
      if (before.period) expect(before.pending.length).toBeGreaterThan(0)
      const after = getMeeting(db, new Date(tomorrow.getTime() + 30 * 60_000), true)
      expect(after.period?.running).toBe(false)
      // No old-rule everyday rows: every scheduled task is a week copy of the demo's chores.
      const scheduled = db.select().from(tasks).where(eq(tasks.origin, 'scheduled')).all()
      expect(scheduled.every((t) => t.planDayAt !== null && WEEK_TITLES.has(t.title))).toBe(true)
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
