import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import { settlements, templates, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { listPeriods, proposalsView, rollPeriods } from '~/server/periods'
import { takerPoints } from '~/server/points'
import { getMeeting } from '~/server/settlement/meeting'
import { listTasks } from '~/server/tasks'
import { rejectionsSince } from '~/server/tasks/rejections'
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

  for (const seed of ['home', 'launch'] as const) {
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
    const meeting = getMeeting(db, new Date(T0.getTime() + 120_000))
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
    const views = listTemplates(db, tata, { choreBidding: true })
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
})
