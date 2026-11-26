import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import type { ClockTime, DeadlineRule, PeriodDefaults } from '~/domain'
import type { Weekday } from '~/domain/dates'
import { fromPragueWallTime, toPragueWallTime } from '~/domain/dates'
import { rollPeriods } from '~/server/periods'
import {
  approveTask,
  cancelTask,
  completeTask,
  expireTask,
  reserveTask,
} from '~/server/tasks/lifecycle'
import type { Family } from '~/server/tasks/testing'
import { T0, family, must } from '~/server/tasks/testing'
import { approveTemplateScore, createTemplate } from '~/server/templates'
import { weekPlanHandler } from './functions'
import { createOnDemandInstance, selfLogInstance } from './instances'
import { MON, MON_10, WED_NOON, copiesOf, prague, setWeekPlan, weekFamily } from './testing'
import { makeWeekCopies } from './weekCopies'
import { getWeekPlan } from './weekPlan'

// The plan table's read (#258, spec §5.12): the running period's days, the agreed chores with
// days, and each day's week copies.

const iso = (d: Date) => d.toISOString()
const day = (month: number, d: number, year = 2026) =>
  iso(fromPragueWallTime({ year, month, day: d, hour: 0, minute: 0 }))
const DAILY = [0, 1, 2, 3, 4, 5, 6] as Weekday[]
const SIX_PM: ClockTime = { hour: 18, minute: 0 }
/** Weeks that end on Sunday 20:00 (the family's meeting evening). */
const SUN_20: PeriodDefaults = {
  ...DEFAULT_PERIOD_DEFAULTS,
  cutoff: { weekday: 0, hour: 20, minute: 0 },
}

function chore(
  f: Family,
  opts: {
    title?: string
    days?: Weekday[] | null
    time?: ClockTime | null
    deadline?: DeadlineRule | null
    agreedAt?: Date | null
  } = {},
): number {
  const days = opts.days === undefined ? DAILY : opts.days
  const id = must(
    createTemplate(
      f.db,
      f.tata,
      {
        title: opts.title ?? 'Nakrmit kočku',
        score: 3,
        approvalRequired: true,
        schedule: days ? { days, time: opts.time === undefined ? SIX_PM : opts.time } : null,
        deadline: opts.deadline ?? null,
      },
      T0,
    ),
  ).id
  if (opts.agreedAt !== null)
    must(approveTemplateScore(f.db, f.starsi, id, 3, opts.agreedAt ?? MON))
  return id
}

/**
 * A week ending Sunday 29. 11. 20:00 (from `start`) with the chore's copies, then the next
 * week rolled at `next` (Sunday 20:00) with its copies made then. `chores` run before the
 * second roll (old-week actions).
 */
function twoWeeks(
  opts: {
    start?: Date
    next?: Date
    days?: Weekday[]
    time?: ClockTime | null
    deadline?: DeadlineRule | null
    before?: (f: Family, tpl: number) => void
  } = {},
) {
  const start = opts.start ?? prague(11, 23, 0)
  const next = opts.next ?? prague(11, 29, 20)
  const f = family()
  rollPeriods(f.db, start, SUN_20)
  const tpl = chore(f, {
    days: opts.days ?? DAILY,
    time: opts.time,
    deadline: opts.deadline,
    agreedAt: start,
  })
  setWeekPlan(f.db, true)
  makeWeekCopies(f.db, new Date(start.getTime() + 60_000))
  opts.before?.(f, tpl)
  rollPeriods(f.db, next, SUN_20)
  makeWeekCopies(f.db, next)
  return { ...f, tpl }
}

/** The copy of the template on the Prague day `d` (UTC ISO). */
const copyOn = (f: Family, tpl: number, d: string) => {
  const r = copiesOf(f.db, tpl).find((c) => c.planDayAt === d)
  if (!r) throw new Error(`no copy on ${d}`)
  return r.id
}

const SUN = day(11, 29)
const SUN_21 = prague(11, 29, 21)
const WEEK_DAYS = [30].map((d) => day(11, d)).concat([1, 2, 3, 4, 5, 6].map((d) => day(12, d)))

describe('getWeekPlan (#258, spec §5.12)', () => {
  it('no running period: empty table', () => {
    const f = family()
    expect(getWeekPlan(f.db, MON_10)).toEqual({
      period: null,
      today: iso(MON),
      days: [],
      rows: [],
    })
  })

  it('columns: a week from Monday 00:00 to Sunday has Mon..Sun', () => {
    const f = weekFamily()
    expect(getWeekPlan(f.db, MON_10).days).toEqual(WEEK_DAYS)
  })

  it('eight columns after a Sunday 20:00 start when a Sunday copy is still open', () => {
    const f = twoWeeks()
    const plan = getWeekPlan(f.db, SUN_21)
    expect(plan.period?.startsAt).toBe(iso(prague(11, 29, 20)))
    expect(plan.days).toEqual([SUN, ...WEEK_DAYS])
    expect(plan.rows[0]?.cells[0]?.map((c) => c.status)).toEqual(['open'])
  })

  it('start day dropped when its only copy was done before the start; kept when done exactly at the start', () => {
    const start = prague(11, 29, 20)
    const before = twoWeeks({
      days: [0],
      before: (f, tpl) => {
        must(completeTask(f.db, f.starsi, copyOn(f, tpl, SUN), new Date(start.getTime() - 1), true))
      },
    })
    expect(getWeekPlan(before.db, SUN_21).days).toEqual(WEEK_DAYS)

    const at = twoWeeks({ days: [0] })
    const id = copyOn(at, at.tpl, SUN)
    must(completeTask(at.db, at.starsi, id, start, true))
    const plan = getWeekPlan(at.db, SUN_21)
    expect(plan.days).toEqual([SUN, ...WEEK_DAYS])
    expect(plan.rows[0]?.cells[0]?.map((c) => [c.id, c.status])).toEqual([[id, 'done_unconfirmed']])
  })

  it('start day dropped when its only copy was cancelled before the start; kept when cancelled exactly at the start', () => {
    const start = prague(11, 29, 20)
    const before = twoWeeks({
      days: [0],
      before: (f, tpl) => {
        must(
          cancelTask(f.db, f.tata, copyOn(f, tpl, SUN), undefined, new Date(start.getTime() - 1)),
        )
      },
    })
    expect(getWeekPlan(before.db, SUN_21).days).toEqual(WEEK_DAYS)

    const at = twoWeeks({ days: [0] })
    const id = copyOn(at, at.tpl, SUN)
    must(cancelTask(at.db, at.tata, id, undefined, start))
    const plan = getWeekPlan(at.db, SUN_21)
    expect(plan.days).toEqual([SUN, ...WEEK_DAYS])
    expect(plan.rows[0]?.cells[0]).toEqual([
      expect.objectContaining({ id, status: 'cancelled', person: null }),
    ])
  })

  it('start day dropped when its only copy expired before the start; kept when its grace ends exactly at the start', () => {
    const noon: DeadlineRule = { dayOffset: 0, due: { hour: 12, minute: 0 }, graceMinutes: 60 }
    const before = twoWeeks({
      days: [0],
      time: { hour: 8, minute: 0 },
      deadline: noon,
      before: (f, tpl) => {
        must(expireTask(f.db, copyOn(f, tpl, SUN), prague(11, 29, 13), true))
      },
    })
    expect(getWeekPlan(before.db, SUN_21).days).toEqual(WEEK_DAYS)

    const seven: DeadlineRule = { dayOffset: 0, due: { hour: 19, minute: 0 }, graceMinutes: 60 }
    const at = twoWeeks({ days: [0], time: { hour: 8, minute: 0 }, deadline: seven })
    const id = copyOn(at, at.tpl, SUN)
    must(expireTask(at.db, id, prague(11, 29, 20), true))
    const plan = getWeekPlan(at.db, SUN_21)
    expect(plan.days).toEqual([SUN, ...WEEK_DAYS])
    expect(plan.rows[0]?.cells[0]?.map((c) => [c.id, c.status])).toEqual([[id, 'expired']])
  })

  it('a period starting at Monday 00:00 keeps Monday with no Monday copy', () => {
    const f = family()
    rollPeriods(f.db, MON, DEFAULT_PERIOD_DEFAULTS)
    chore(f, { days: [2] as Weekday[] })
    setWeekPlan(f.db, true)
    makeWeekCopies(f.db, MON_10)
    const plan = getWeekPlan(f.db, MON_10)
    expect(plan.days).toEqual(WEEK_DAYS)
    expect(plan.rows[0]?.cells.map((c) => c.length)).toEqual([0, 1, 0, 0, 0, 0, 0])
  })

  it('a day starting exactly at the cutoff is not a column (cutoff Monday 00:00)', () => {
    const f = family()
    rollPeriods(f.db, MON, {
      ...DEFAULT_PERIOD_DEFAULTS,
      cutoff: { weekday: 1, hour: 0, minute: 0 },
    })
    const plan = getWeekPlan(f.db, MON_10)
    expect(plan.period?.cutoffAt).toBe(day(12, 7))
    expect(plan.days).toEqual(WEEK_DAYS)
  })

  it.each([
    [
      'autumn',
      prague(10, 19, 0),
      prague(10, 25, 20),
      [25, 26, 27, 28, 29, 30, 31].map((d) => day(10, d)).concat(day(11, 1)),
    ],
    [
      'spring',
      prague(3, 23, 0),
      prague(3, 29, 20),
      [29, 30, 31].map((d) => day(3, d)).concat([1, 2, 3, 4, 5].map((d) => day(4, d))),
    ],
  ])(
    'DST weeks (%s): one column per Prague day across the clock change',
    (_name, start, next, expected) => {
      const f = twoWeeks({ start, next })
      const plan = getWeekPlan(f.db, new Date(next.getTime() + 3_600_000))
      expect(plan.days).toEqual(expected)
      expect(new Set(plan.days).size).toBe(8)
      expect(plan.days.every((d) => toPragueWallTime(new Date(d)).hour === 0)).toBe(true)
      expect(plan.rows[0]?.cells.map((c) => c.length)).toEqual(Array(8).fill(1))
    },
  )

  it('rows: active templates with days only, in Czech title order; one agreed mid-week is blank before its first copy', () => {
    const f = family()
    rollPeriods(f.db, MON, DEFAULT_PERIOD_DEFAULTS)
    const kytky = chore(f, { title: 'Zalít kytky' })
    const boty = chore(f, { title: 'Čistit boty' })
    chore(f, { title: 'Vynést koše', agreedAt: null })
    chore(f, { title: 'Koupit chleba', days: null })
    setWeekPlan(f.db, true)
    makeWeekCopies(f.db, MON_10)
    const prach = chore(f, { title: 'Utřít prach', agreedAt: WED_NOON })
    const plan = getWeekPlan(f.db, WED_NOON)
    expect(plan.rows.map((r) => [r.templateId, r.title, r.scheduleDays])).toEqual([
      [boty, 'Čistit boty', DAILY],
      [prach, 'Utřít prach', DAILY],
      [kytky, 'Zalít kytky', DAILY],
    ])
    expect(plan.rows[1]?.cells.map((c) => c.length)).toEqual([0, 0, 1, 1, 1, 1, 1])
  })

  it('cells: every state, with who holds or did it', () => {
    const f = weekFamily()
    const [, tue = 0, wed = 0, thu = 0, fri = 0, sat = 0] = f.day
    must(reserveTask(f.db, f.mladsi, tue, MON_10, true))
    must(completeTask(f.db, f.starsi, wed, prague(12, 2, 19), true))
    must(completeTask(f.db, f.starsi, thu, prague(12, 3, 19), true))
    must(approveTask(f.db, f.tata, thu, prague(12, 3, 20)))
    must(expireTask(f.db, fri, prague(12, 5, 0, 5), true))
    must(cancelTask(f.db, f.tata, sat, undefined, prague(12, 5, 10)))
    const cells = getWeekPlan(f.db, prague(12, 5, 12)).rows[0]?.cells ?? []
    expect(cells.slice(0, 6).map((c) => c.map((x) => [x.status, x.person]))).toEqual([
      [['open', null]],
      [['reserved', { id: f.mladsi, name: 'Mladší' }]],
      [['done_unconfirmed', { id: f.starsi, name: 'Starší' }]],
      [['confirmed', { id: f.starsi, name: 'Starší' }]],
      [['expired', null]],
      [['cancelled', null]],
    ])
  })

  it('a done cell shows who did it, not who reserved it', () => {
    const f = weekFamily()
    const mon = f.day[0] ?? 0
    must(reserveTask(f.db, f.mladsi, mon, MON_10, true))
    must(completeTask(f.db, f.tata, mon, prague(11, 30, 19), true))
    const cell = getWeekPlan(f.db, prague(11, 30, 19)).rows[0]?.cells[0]
    expect(cell?.map((c) => c.person)).toEqual([{ id: f.tata, name: 'Táta' }])
  })

  it('several copies on one day, oldest first', () => {
    const f = weekFamily()
    const extra = must(createOnDemandInstance(f.db, f.tata, f.cat, prague(11, 30, 11)))
    const cell = getWeekPlan(f.db, prague(11, 30, 12)).rows[0]?.cells[0]
    expect(cell?.map((c) => [c.id, c.origin])).toEqual([
      [f.day[0], 'scheduled'],
      [extra.id, 'on_demand'],
    ])
  })

  it('old-rule instances and self-logs are not copies', () => {
    const f = family()
    rollPeriods(f.db, MON, DEFAULT_PERIOD_DEFAULTS)
    const tpl = chore(f)
    // The log first: an open copy on the board refuses it.
    must(selfLogInstance(f.db, f.starsi, tpl, 3, MON_10, 'now'))
    must(createOnDemandInstance(f.db, f.tata, tpl, prague(11, 30, 11)))
    expect(copiesOf(f.db, tpl)).toHaveLength(2)
    setWeekPlan(f.db, true)
    const plan = getWeekPlan(f.db, prague(11, 30, 12))
    expect(plan.rows.map((r) => r.templateId)).toEqual([tpl])
    expect(plan.rows[0]?.cells.every((c) => c.length === 0)).toBe(true)
  })

  it('shape is pinned: nothing else of a task or a person leaves the server', () => {
    const f = family()
    rollPeriods(f.db, MON, DEFAULT_PERIOD_DEFAULTS)
    const tpl = chore(f, { title: 'Vynést koše', days: [2, 5] as Weekday[] })
    setWeekPlan(f.db, true)
    const [tue, fri] = makeWeekCopies(f.db, MON_10).map((r) => r.id)
    must(reserveTask(f.db, f.mladsi, tue ?? 0, prague(11, 30, 11), true))
    const plan = getWeekPlan(f.db, prague(11, 30, 12))
    expect(plan).toEqual({
      period: { startsAt: iso(MON), cutoffAt: iso(prague(12, 6, 23, 59)) },
      today: iso(MON),
      days: WEEK_DAYS,
      rows: [
        {
          templateId: tpl,
          title: 'Vynést koše',
          scheduleDays: [2, 5],
          cells: [
            [],
            [
              {
                id: tue,
                status: 'reserved',
                score: 3,
                origin: 'scheduled',
                createdAt: iso(MON_10),
                person: { id: f.mladsi, name: 'Mladší' },
              },
            ],
            [],
            [],
            [
              {
                id: fri,
                status: 'open',
                score: 3,
                origin: 'scheduled',
                createdAt: iso(MON_10),
                person: null,
              },
            ],
            [],
            [],
          ],
        },
      ],
    })
    const reserved = plan.rows[0]?.cells[1]?.[0]
    expect(Object.keys(reserved ?? {})).toEqual([
      'id',
      'status',
      'score',
      'origin',
      'createdAt',
      'person',
    ])
    expect(Object.keys(reserved?.person ?? {})).toEqual(['id', 'name'])
  })
})

describe('weekPlanHandler (#258)', () => {
  it('switch off answers feature_off', () => {
    const f = weekFamily()
    setWeekPlan(f.db, false)
    expect(weekPlanHandler(f.db, MON_10)).toEqual({ error: 'feature_off' })
  })

  it('switch on: the table, the same for a taker and a giver (the function takes no viewer)', () => {
    const f = weekFamily()
    must(reserveTask(f.db, f.mladsi, f.day[1] ?? 0, MON_10, true))
    expect(weekPlanHandler(f.db, MON_10)).toEqual(getWeekPlan(f.db, MON_10))
    expect(weekPlanHandler.length).toBe(2)
  })
})
