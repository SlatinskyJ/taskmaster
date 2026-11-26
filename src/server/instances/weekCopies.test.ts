import { asc, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import type { ClockTime, DeadlineRule } from '~/domain'
import type { Weekday } from '~/domain/dates'
import { fromPragueWallTime } from '~/domain/dates'
import { auditLog, tasks, templateSlots } from '~/server/db/schema'
import { rollPeriods } from '~/server/periods'
import type { Family } from '~/server/tasks/testing'
import { T0, family, json, must } from '~/server/tasks/testing'
import { approveTemplateScore, createTemplate } from '~/server/templates'
import { makeWeekCopies } from './weekCopies'

// Week chore copies (#257, spec §5.12): every slot of the running week gets its copy at once,
// marked with its Prague day.

const prague = (month: number, day: number, hour: number, minute = 0, year = 2026) =>
  fromPragueWallTime({ year, month, day, hour, minute })

const MON = prague(11, 30, 0)
const MON_10 = prague(11, 30, 10)
const SIX_PM: ClockTime = { hour: 18, minute: 0 }
const DAILY = [0, 1, 2, 3, 4, 5, 6] as Weekday[]
const TUE_FRI = [2, 5] as Weekday[]
/** "next day, 7:00", grace 60 min. */
const NEXT_MORNING: DeadlineRule = { dayOffset: 1, due: { hour: 7, minute: 0 }, graceMinutes: 60 }

function chore(
  f: Family,
  opts: {
    title?: string
    days?: Weekday[]
    time?: ClockTime | null
    deadline?: DeadlineRule | null
    agreedAt?: Date
  } = {},
): number {
  const id = must(
    createTemplate(
      f.db,
      f.tata,
      {
        title: opts.title ?? 'Nakrmit kočku',
        score: 3,
        approvalRequired: true,
        schedule: { days: opts.days ?? DAILY, time: opts.time === undefined ? SIX_PM : opts.time },
        deadline: opts.deadline ?? null,
      },
      T0,
    ),
  ).id
  must(approveTemplateScore(f.db, f.starsi, id, 3, opts.agreedAt ?? MON))
  return id
}

/** A family with a period running from `start` (7 days by default). */
function week(start = MON, lengthDays = 7) {
  const f = family()
  rollPeriods(f.db, start, { ...DEFAULT_PERIOD_DEFAULTS, lengthDays })
  return f
}

const rowsOf = (f: Family, templateId: number) =>
  f.db.select().from(tasks).where(eq(tasks.templateId, templateId)).orderBy(asc(tasks.id)).all()

const lastSlot = (f: Family, templateId: number) =>
  f.db.select().from(templateSlots).where(eq(templateSlots.templateId, templateId)).get()
    ?.lastSlotAt

const run = (f: Family, at: Date, opts: { templateId?: number } = {}) =>
  makeWeekCopies(f.db, at, { ...opts, log: { error: vi.fn() } })

const iso = (d: Date) => d.toISOString()

describe('makeWeekCopies (#257, spec §5.12)', () => {
  it('makes one open copy per slot of the running week at once, each marked with its Prague day, audited instance.created by the system with slotAt and planDayAt', () => {
    const f = week()
    const tpl = chore(f, { days: TUE_FRI })
    const made = run(f, MON_10)
    expect(made.map((r) => r.id)).toEqual(rowsOf(f, tpl).map((r) => r.id))
    expect(made.map((r) => [r.status, r.origin, r.planDayAt, r.weekRules, r.createdAt])).toEqual([
      ['open', 'scheduled', iso(prague(12, 1, 0)), true, iso(MON_10)],
      ['open', 'scheduled', iso(prague(12, 4, 0)), true, iso(MON_10)],
    ])
    expect(made.every((r) => r.dueAt === null && r.updatedAt === iso(MON_10))).toBe(true)
    const entries = f.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'instance.created'))
      .all()
    expect(entries.map((e) => [e.actorKind, e.entityId, e.at])).toEqual(
      made.map((r) => ['system', String(r.id), iso(MON_10)]),
    )
    expect(json(entries[0]?.after)).toMatchObject({
      templateId: tpl,
      origin: 'scheduled',
      status: 'open',
      slotAt: iso(prague(12, 1, 18)),
      planDayAt: iso(prague(12, 1, 0)),
    })
    expect(lastSlot(f, tpl)).toBe(iso(prague(12, 4, 18)))
  })

  it('a deadline copy is due by its rule from its slot (Tuesday bins made Monday are due Wednesday 7:00)', () => {
    const f = week()
    const tpl = chore(f, { title: 'Vynést koše', days: [2] as Weekday[], deadline: NEXT_MORNING })
    run(f, MON_10)
    const [bins, ...more] = rowsOf(f, tpl)
    expect(more).toEqual([])
    expect(bins).toMatchObject({
      status: 'open',
      dueAt: iso(prague(12, 2, 7)),
      graceEndsAt: iso(prague(12, 2, 8)),
      planDayAt: iso(prague(12, 1, 0)),
    })
  })

  it('a no-deadline template gets a copy every slot even while an earlier one is still open', () => {
    const f = week()
    const tpl = chore(f)
    expect(run(f, MON_10)).toHaveLength(7)
    expect(rowsOf(f, tpl).map((r) => r.planDayAt)).toEqual(
      [30, 1, 2, 3, 4, 5, 6].map((d) => iso(prague(d === 30 ? 11 : 12, d, 0))),
    )
    expect(rowsOf(f, tpl).every((r) => r.status === 'open')).toBe(true)
  })

  it('running it again makes nothing (template_slots)', () => {
    const f = week()
    const tpl = chore(f)
    run(f, MON_10)
    expect(run(f, MON_10)).toEqual([])
    expect(run(f, prague(12, 3, 12))).toEqual([])
    expect(rowsOf(f, tpl)).toHaveLength(7)
    expect(lastSlot(f, tpl)).toBe(iso(prague(12, 6, 18)))
  })

  it('after downtime only the latest missed slot is made, plus every future one; a missed one already over is made and expired', () => {
    const f = week()
    const tpl = chore(f)
    const thu10 = prague(12, 3, 10)
    run(f, thu10)
    const rows = rowsOf(f, tpl)
    expect(rows.map((r) => [r.planDayAt, r.status, r.createdAt])).toEqual([
      [iso(prague(12, 2, 0)), 'expired', iso(prague(12, 2, 18))],
      [iso(prague(12, 3, 0)), 'open', iso(thu10)],
      [iso(prague(12, 4, 0)), 'open', iso(thu10)],
      [iso(prague(12, 5, 0)), 'open', iso(thu10)],
      [iso(prague(12, 6, 0)), 'open', iso(thu10)],
    ])
    const expiry = f.db.select().from(auditLog).where(eq(auditLog.action, 'instance.expired')).all()
    expect(expiry.map((e) => [e.actorKind, e.entityId])).toEqual([['system', String(rows[0]?.id)]])
  })

  it('after downtime a missed deadline copy whose day is over but whose grace is not stays open (Tuesday bins due Wednesday 7:00, first tick Wednesday 6:00)', () => {
    const f = week()
    const tpl = chore(f, { title: 'Vynést koše', days: TUE_FRI, deadline: NEXT_MORNING })
    const wed6 = prague(12, 2, 6)
    const made = run(f, wed6)
    expect(made.map((r) => [r.planDayAt, r.status, r.dueAt])).toEqual([
      [iso(prague(12, 1, 0)), 'open', iso(prague(12, 2, 7))],
      [iso(prague(12, 4, 0)), 'open', iso(prague(12, 5, 7))],
    ])
    expect(rowsOf(f, tpl)).toHaveLength(2)
    expect(lastSlot(f, tpl)).toBe(iso(prague(12, 4, 18)))
  })

  it('a slot exactly at `at` counts as past: it is the catch-up slot; a slot exactly at `at` + 14 days is not made', () => {
    const f = week(MON, 21)
    const tpl = chore(f)
    const at = prague(11, 30, 18)
    run(f, at)
    const rows = rowsOf(f, tpl)
    expect(rows[0]).toMatchObject({ planDayAt: iso(MON), status: 'open', createdAt: iso(at) })
    // 14 days later at 18:00 is the bound (half-open): Sunday 12-13 is the last copy.
    expect(rows).toHaveLength(14)
    expect(rows.at(-1)?.planDayAt).toBe(iso(prague(12, 13, 0)))
  })

  it('a 21-day period: copies only up to now + 14 days; a tick a week later adds the next week’s', () => {
    const f = week(MON, 21)
    const tpl = chore(f)
    run(f, MON_10)
    expect(rowsOf(f, tpl)).toHaveLength(14)
    expect(lastSlot(f, tpl)).toBe(iso(prague(12, 13, 18)))
    // A week later: up to the cutoff (Sunday 12-20 23:59), which comes before now + 14 days.
    const made = run(f, prague(12, 7, 10))
    expect(made.map((r) => r.planDayAt)).toEqual(
      [14, 15, 16, 17, 18, 19, 20].map((d) => iso(prague(12, d, 0))),
    )
    expect(rowsOf(f, tpl)).toHaveLength(21)
  })

  it('a template agreed mid-week (opts.templateId) gets copies only for its remaining slots', () => {
    const f = week()
    const other = chore(f, { title: 'Zalít kytky' })
    const wed12 = prague(12, 2, 12)
    const tpl = chore(f, { days: TUE_FRI, agreedAt: wed12 })
    const made = run(f, wed12, { templateId: tpl })
    expect(made.map((r) => [r.templateId, r.planDayAt])).toEqual([[tpl, iso(prague(12, 4, 0))]])
    expect(rowsOf(f, other)).toEqual([])
    const daily = chore(f, { title: 'Vyvenčit psa', agreedAt: wed12 })
    expect(run(f, wed12, { templateId: daily }).map((r) => r.planDayAt)).toEqual(
      [2, 3, 4, 5, 6].map((d) => iso(prague(12, d, 0))),
    )
  })

  it('no running period → no copies', () => {
    const f = family()
    const tpl = chore(f)
    expect(run(f, MON_10)).toEqual([])
    expect(rowsOf(f, tpl)).toEqual([])
    expect(lastSlot(f, tpl)).toBeUndefined()
  })

  it('a template without a schedule gets nothing', () => {
    const f = week()
    const id = must(
      createTemplate(
        f.db,
        f.tata,
        { title: 'Umýt okna', score: 3, approvalRequired: true, schedule: null, deadline: null },
        T0,
      ),
    ).id
    must(approveTemplateScore(f.db, f.starsi, id, 3, MON))
    expect(run(f, MON_10)).toEqual([])
  })

  it('a week over the DST change (2026-10-19 … 2026-10-26): a daily 18:00 no-deadline copy for Sunday 2026-10-25 has plan_day_at 2026-10-24T22:00:00.000Z, and a next-day-7:00 deadline copy for the Sunday is due 2026-10-26 07:00 Prague (06:00Z)', () => {
    const start = prague(10, 19, 0)
    const f = week(start)
    const cat = chore(f, { agreedAt: start })
    const bins = chore(f, { title: 'Vynést koše', deadline: NEXT_MORNING, agreedAt: start })
    run(f, prague(10, 19, 10))
    const catRows = rowsOf(f, cat)
    expect(catRows).toHaveLength(7)
    expect(catRows.at(-1)?.planDayAt).toBe('2026-10-24T22:00:00.000Z')
    expect(catRows.at(-2)?.planDayAt).toBe('2026-10-23T22:00:00.000Z')
    const binRows = rowsOf(f, bins)
    expect(binRows.at(-2)?.dueAt).toBe('2026-10-25T06:00:00.000Z')
    expect(binRows.at(-1)?.dueAt).toBe('2026-10-26T06:00:00.000Z')
  })

  it('a failed audit write leaves no copy and no template_slots row for that template, and the other templates still get theirs', () => {
    const f = week()
    const ok = chore(f, { title: 'Zalít kytky' })
    const broken = chore(f, { title: 'Vynést koše' })
    f.db.$client.exec(
      `CREATE TRIGGER fail_copy BEFORE INSERT ON audit_log
       WHEN NEW.action = 'instance.created' AND json_extract(NEW.after, '$.templateId') = ${String(broken)}
       BEGIN SELECT RAISE(ABORT, 'audit down'); END`,
    )
    const log = { error: vi.fn() }
    makeWeekCopies(f.db, MON_10, { log })
    expect(rowsOf(f, broken)).toEqual([])
    expect(lastSlot(f, broken)).toBeUndefined()
    expect(rowsOf(f, ok)).toHaveLength(7)
    expect(log.error).toHaveBeenCalledWith(
      `[scheduler] week copies: template ${String(broken)} failed`,
      expect.anything(),
    )
  })
})
