import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS, isLastDay, isRunning } from '~/domain'
import { settlements, templates, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { listPeriods, proposalsView, rollPeriods } from '~/server/periods'
import { takerPoints } from '~/server/points'
import { getMeeting } from '~/server/settlement/meeting'
import { listTasks } from '~/server/tasks'
import { rejectionsSince } from '~/server/tasks/rejections'
import { getFlags } from '~/server/features/flags'
import { getWeekPlan } from '~/server/instances/weekPlan'
import { auditLog } from '~/server/db/schema'
import { fromPragueWallTime } from '~/domain/dates'
import { NO_FEATURES } from '~/lib/features'
import { listTemplates } from '~/server/templates/templates'
import { seedDemo } from './seed'
import type { SeedName } from './seeds'

// The numbers each e2e suite's seed gives (#183), pinned next to the seeds: a seed change
// fails here before it fails a browser test. Keep in step with e2e/*.spec.ts.

const T0 = new Date('2026-11-17T10:00:00.000Z')

function seeded(seed: SeedName) {
  const db = createTestDb()
  seedDemo(db, { TASKMASTER_ENV: 'preview', TASKMASTER_SEED: seed }, T0)
  // The roller starts the week at boot, right after the seed.
  rollPeriods(db, new Date(T0.getTime() + 60_000), DEFAULT_PERIOD_DEFAULTS)
  return db
}

const byState = (db: ReturnType<typeof createTestDb>) => {
  const out: Record<string, string[]> = {}
  for (const t of listTasks(db)) (out[t.status] ??= []).push(t.title)
  for (const titles of Object.values(out)) titles.sort()
  return out
}

describe('e2e seeds (#183)', () => {
  it('family: the four people and nothing else', () => {
    const db = seeded('family')
    expect(db.select().from(users).all()).toHaveLength(4)
    expect(listTasks(db)).toHaveLength(0)
    expect(db.select().from(templates).all()).toHaveLength(0)
  })

  for (const seed of ['home', 'launch', 'approve'] as const) {
    it(`${seed}: Starší 40 + 12, Mladší 55 + 0, and a task in each state Domů and Úkoly show`, () => {
      const db = seeded(seed)
      expect(takerPoints(db, T0).takers.map((t) => [t.name, t.confirmed, t.pending])).toEqual([
        ['Starší', 40, 12],
        ['Mladší', 55, 0],
      ])
      expect(byState(db)).toEqual({
        proposed: ['Uklidit sklep', 'Umýt auto'],
        reserved: ['Vyluxovat celý obývák a chodbu'],
        open: ['Umýt okna v obýváku i v ložnici'],
        done_unconfirmed: ['Vytřít podlahu v kuchyni'],
        confirmed: ['Pověsit prádlo', 'Uklidit pokoj', 'Umýt nádobí', 'Vynést tříděný odpad'],
      })
      expect(db.select().from(templates).all()).toHaveLength(0)
      expect(listPeriods(db)).toHaveLength(1)
    })
  }

  it('rows (#205): recurring, week and openRows on; e2e/rows.spec.ts opens these ids', () => {
    const db = seeded('rows')
    expect(getFlags(db)).toEqual({ ...NO_FEATURES, recurring: true, week: true, openRows: true })
    const byId = new Map(listTasks(db).map((t) => [t.id, t]))
    expect([byId.get(9)?.title, byId.get(9)?.status]).toEqual([
      'Umýt okna v obýváku i v ložnici',
      'open',
    ])
    expect([byId.get(3)?.title, byId.get(3)?.status]).toEqual([
      'Vyluxovat celý obývák a chodbu',
      'reserved',
    ])
    expect([byId.get(12)?.title, byId.get(12)?.templateId]).toEqual(['Nachystat tašku do školy', 3])
    const tpl = db.select().from(templates).all()
    expect(tpl.map((t) => [t.id, t.title, t.status])).toEqual([
      [1, 'Vynést koše', 'proposed'],
      [2, 'Vyndat myčku', 'active'],
      [3, 'Nachystat tašku do školy', 'active'],
    ])
  })

  it('descriptions (#207): e2e/descriptions.spec.ts opens tasks 1 and 2 and chore 1', () => {
    const db = seeded('descriptions')
    expect(getFlags(db)).toEqual({
      ...NO_FEATURES,
      descriptions: true,
      openRows: true,
      recurring: true,
    })
    const byId = new Map(listTasks(db).map((t) => [t.id, t]))
    expect([byId.get(1)?.title, byId.get(1)?.status]).toEqual(['Uklidit kolárnu', 'proposed'])
    expect([byId.get(2)?.title, byId.get(2)?.status]).toEqual(['Odnést krabice do sklepa', 'open'])
    const tpl = db.select().from(templates).all()
    expect(tpl.map((t) => [t.id, t.title, t.status])).toEqual([
      [1, 'Utřít prach v pokoji', 'active'],
    ])
  })

  it('approve (#206): only the approveAnywhere switch on; e2e/approve.spec.ts opens tasks 6 and 3', () => {
    const db = seeded('approve')
    expect(getFlags(db)).toEqual({ ...NO_FEATURES, approveAnywhere: true })
    const byId = new Map(listTasks(db).map((t) => [t.id, t.title]))
    expect(byId.get(6)).toBe('Vytřít podlahu v kuchyni')
    expect(byId.get(3)).toBe('Vyluxovat celý obývák a chodbu')
  })

  it('tasks: only "Shrabat listí na zahradě", open at 10, Táta’s 12 waiting for both', () => {
    const db = seeded('tasks')
    const all = listTasks(db)
    expect(all.map((t) => [t.title, t.status, t.score])).toEqual([
      ['Shrabat listí na zahradě', 'open', 10],
    ])
    expect(all[0]?.scoreChange).toMatchObject({
      score: 12,
      waitingFor: [{ name: 'Starší' }, { name: 'Mladší' }],
    })
  })

  it('week: last week settled (108 → 8 carried, 50 → 0), this week 120 / 47, two waiting', () => {
    const db = seeded('week')
    const name = (id: number) => db.select().from(users).where(eq(users.id, id)).get()?.username
    expect(
      db
        .select()
        .from(settlements)
        .all()
        .map((r) => [name(r.takerId), r.totalBefore, r.level, r.deducted, r.carryOver]),
    ).toEqual([
      ['starsi', 108, 'upper', 100, 8],
      ['mladsi', 50, 'lower', 50, 0],
    ])
    const meeting = getMeeting(db, new Date(T0.getTime() + 120_000), false)
    if (!meeting.period) throw new Error('no meeting')
    expect(meeting.takers.map((t) => [t.name, t.total])).toEqual([
      ['Starší', 120],
      ['Mladší', 47],
    ])
    expect(meeting.pending.map((t) => [t.title, t.score, t.completedBy?.name])).toEqual([
      ['Zalít kytky', 2, 'Starší'],
      ['Vynést tříděný', 3, 'Mladší'],
    ])
    const current = listPeriods(db)[1]
    if (!current) throw new Error('no current week')
    expect(rejectionsSince(db, current.startsAt).map((r) => [r.title, name(r.earnerId)])).toEqual([
      ['Vynést sklo a plasty do kontejneru', 'mladsi'],
    ])
  })

  it('proposals: Starší’s next week (60/120) waits for Mladší; Táta’s 14-day default week for both boys', () => {
    const db = seeded('proposals')
    const id = (u: string) => db.select().from(users).where(eq(users.username, u)).get()?.id
    const v = proposalsView(db, new Date(T0.getTime() + 120_000))
    expect(v.period).toMatchObject({
      status: 'pending',
      proposedBy: id('starsi'),
      approvedBy: [id('starsi'), id('tata')],
      waitingFor: [id('mladsi')],
      settings: { cutoffAt: v.defaultNext?.cutoffAt, levels: { lower: 60, upper: 120 } },
    })
    expect(v.defaults).toMatchObject({
      status: 'pending',
      proposedBy: id('tata'),
      waitingFor: [id('starsi'), id('mladsi')],
      settings: { lengthDays: 14, levels: { lower: 60, upper: 120 } },
    })
  })

  it('chores: Vynést kompost at 10 with no bids, Zalít kytky at 4 with Starší 6 and Mladší 7', () => {
    const db = seeded('chores')
    expect(listTasks(db)).toHaveLength(0)
    const tata = db.select().from(users).where(eq(users.username, 'tata')).get()?.id ?? 0
    // Newest first, as Úkoly lists them.
    const views = listTemplates(db, tata, { choreBidding: true, bidRefusals: false })
    expect(views.map((t) => [t.title, t.status, t.score])).toEqual([
      ['Zalít kytky', 'proposed', 4],
      ['Vynést kompost', 'proposed', 10],
    ])
    expect(views[1]?.bidding?.bids).toEqual([])
    expect(views[0]?.bidding?.bids.map((b) => [b.name, b.score])).toEqual([
      ['Starší', 6],
      ['Mladší', 7],
    ])
  })

  it('chorechange: Umýt koupelnu agreed at 8, Starší bids 10 and Mladší 11, no offer', () => {
    const db = seeded('chorechange')
    const tata = db.select().from(users).where(eq(users.username, 'tata')).get()?.id ?? 0
    const views = listTemplates(db, tata, { choreBidding: false, bidRefusals: true })
    expect(views.map((t) => [t.title, t.status, t.score])).toEqual([['Umýt koupelnu', 'active', 8]])
    expect(views[0]?.change?.offer).toBeNull()
    expect(views[0]?.change?.bids.map((b) => [b.name, b.score])).toEqual([
      ['Starší', 10],
      ['Mladší', 11],
    ])
  })
  it.each([
    ['Wed 2. 12.', 12, 2, [12, 1], 6],
    ['Mon 30. 11.', 11, 30, [11, 29], 8],
  ])(
    "plantable (#258) at %s 10:00: yesterday's column, today Mladší holds the long chore, Starší's flowers wait, the table is free",
    (_name, month, d, yesterday, columns) => {
      const now = fromPragueWallTime({ year: 2026, month, day: d, hour: 10, minute: 0 })
      const db = createTestDb()
      seedDemo(db, { TASKMASTER_ENV: 'preview', TASKMASTER_SEED: 'plantable' }, now)
      const plan = getWeekPlan(db, now)
      const [ym = 0, yd = 0] = yesterday
      const start = fromPragueWallTime({ year: 2026, month: ym, day: yd, hour: 0, minute: 0 })
      // The week starts at yesterday's midnight; on a Monday that is a Sunday: 8 columns.
      expect(plan.period?.startsAt).toBe(start.toISOString())
      expect(plan.days).toHaveLength(columns)
      expect(plan.rows.map((r) => r.title)).toEqual([
        'Prostřít stůl k večeři',
        'Vyluxovat celý obývák a chodbu',
        'Vynést koš na plasty',
        'Zalít kytky na balkoně',
      ])
      const at = plan.days.indexOf(plan.today)
      expect(at).toBe(1)
      const cell = (row: number, col: number) =>
        plan.rows[row]?.cells[col]?.map((c) => [c.status, c.person?.name ?? null])
      // Yesterday: the table free (no job has run yet), the vacuum expired, the flowers confirmed.
      expect([cell(0, 0), cell(1, 0), cell(3, 0)]).toEqual([
        [['open', null]],
        [['expired', null]],
        [['confirmed', 'Starší']],
      ])
      // Today.
      expect([cell(0, at), cell(1, at), cell(3, at)]).toEqual([
        [['open', null]],
        [['reserved', 'Mladší']],
        [['done_unconfirmed', 'Starší']],
      ])
      // Tomorrow's vacuum is Starší's.
      expect(cell(1, at + 1)).toEqual([['reserved', 'Starší']])
      expect(getFlags(db)).toEqual({ ...NO_FEATURES, recurring: true, week: true, weekPlan: true })
      const log = db
        .select({ at: auditLog.at })
        .from(auditLog)
        .orderBy(auditLog.id)
        .all()
        .map((r) => r.at)
      expect(log).toEqual([...log].sort())
    },
  )

  it.each([16, 17, 18, 19, 20, 21, 22])(
    'planmeeting (#259) on 11. %i. 2026 at 10:00: one ended unsettled week, the running week not on its last day',
    (day) => {
      const now = fromPragueWallTime({ year: 2026, month: 11, day, hour: 10, minute: 0 })
      const db = createTestDb()
      seedDemo(db, { TASKMASTER_ENV: 'preview', TASKMASTER_SEED: 'planmeeting' }, now)
      const [ended, running, ...rest] = listPeriods(db)
      expect(rest).toEqual([])
      expect(ended && isRunning(ended, now)).toBe(false)
      expect(ended && ended.cutoffAt.getTime() < now.getTime()).toBe(true)
      expect(running && isRunning(running, now)).toBe(true)
      expect(running && isLastDay(running, now)).toBe(false)
      // As after a Sunday-evening meeting: the running week starts today 00:00, for seven days.
      const today = fromPragueWallTime({ year: 2026, month: 11, day, hour: 0, minute: 0 })
      expect(running?.startsAt).toEqual(today)
      expect(ended?.cutoffAt).toEqual(today)
      const plan = getWeekPlan(db, now)
      expect(plan.days).toHaveLength(7)
      // Today's column has each chore's copy (agreed in the ended week, not now).
      const at = plan.days.indexOf(plan.today)
      expect(at).toBe(0)
      const todays = Object.fromEntries(
        plan.rows.map((r) => [
          r.title,
          r.cells[at]?.map((c) => [c.status, c.person?.name ?? null]) ?? [],
        ]),
      )
      expect(todays['Prostřít stůl k večeři']).toEqual([['open', null]])
      expect(todays['Zalít kytky na balkoně']).toEqual([['open', null]])
      expect(todays['Vyluxovat celý obývák a chodbu']).toEqual([['reserved', 'Mladší']])
      const binToday = [2, 5].includes(new Date(now).getDay()) // Út, Pá (Prague day = UTC day at 10:00)
      expect(todays['Vynést koš na plasty']).toEqual(binToday ? [['open', null]] : [])
      expect(db.select().from(settlements).all()).toEqual([])
      expect(getFlags(db)).toEqual({
        ...NO_FEATURES,
        recurring: true,
        week: true,
        meeting: true,
        weekPlan: true,
        settleLastDay: true,
      })
      const meeting = getMeeting(db, now, true)
      expect(meeting.period?.id).toBe(ended?.id)
      expect(meeting.settledToday).toBe(false)
      if (meeting.period) expect(meeting.pending).toEqual([])
      expect(getWeekPlan(db, now).rows.map((r) => r.title)).toContain('Prostřít stůl k večeři')
      const log = db
        .select({ at: auditLog.at })
        .from(auditLog)
        .orderBy(auditLog.id)
        .all()
        .map((r) => r.at)
      expect(log).toEqual([...log].sort())
    },
  )
})
