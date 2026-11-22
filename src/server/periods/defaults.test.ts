import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import type { PeriodDefaults } from '~/domain'
import { fromPragueWallTime } from '~/domain/dates'
import type { Weekday } from '~/domain/dates'
import type { Db } from '~/server/db'
import { auditLog, periodDefaults } from '~/server/db/schema'
import { failAuditOn, family, json, must } from '~/server/tasks/testing'
import { getPeriodDefaults, savePeriodDefaults, writePeriodDefaults } from './defaults'
import { currentPeriod, listPeriods, rollPeriods } from './periods'

const prague = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  fromPragueWallTime({ year, month, day, hour, minute })
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms)

const D = DEFAULT_PERIOD_DEFAULTS
const SAT = prague(2026, 11, 21, 20) // first roll
const CUTOFF = prague(2026, 11, 29, 23, 59) // first period's cutoff
const SAVE_AT = prague(2026, 11, 25, 12)

/** 14 days, Saturday 20:00, 60/120. */
const NEW: PeriodDefaults = {
  lengthDays: 14,
  cutoff: { weekday: 6, hour: 20, minute: 0 },
  levels: { lower: 60, upper: 120 },
}

const settingsAudit = (db: Db) =>
  db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, 'settings.changed'))
    .orderBy(asc(auditLog.id))
    .all()

const asJson = (d: PeriodDefaults) => ({
  lengthDays: d.lengthDays,
  cutoff: { ...d.cutoff },
  levels: { ...d.levels },
})

describe('getPeriodDefaults', () => {
  it('reads the seeded defaults', () => {
    expect(getPeriodDefaults(family().db)).toEqual(D)
  })

  it('reads the code defaults when the row is gone', () => {
    const { db } = family()
    db.delete(periodDefaults).run()
    expect(getPeriodDefaults(db)).toEqual(D)
  })
})

describe('savePeriodDefaults', () => {
  it('admin saves 14 days, Saturday 20:00, 60/120', () => {
    const f = family()
    expect(savePeriodDefaults(f.db, f.admin, NEW, SAVE_AT)).toEqual({ ok: true, value: NEW })
    expect(getPeriodDefaults(f.db)).toEqual(NEW)
    expect(f.db.select().from(periodDefaults).get()).toMatchObject({
      updatedBy: f.admin,
      updatedAt: SAVE_AT.toISOString(),
    })
    const [entry, ...rest] = settingsAudit(f.db)
    expect(rest).toEqual([])
    expect(entry).toMatchObject({
      actorKind: 'user',
      actorUserId: f.admin,
      entityType: 'settings',
      entityId: '1',
    })
    expect(json(entry?.before)).toEqual(asJson(D))
    expect(json(entry?.after)).toEqual(asJson(NEW))
  })

  it('saving the same values again is allowed and audited', () => {
    const f = family()
    must(savePeriodDefaults(f.db, f.admin, D, SAVE_AT))
    expect(settingsAudit(f.db)).toHaveLength(1)
  })

  it('a save recreates a deleted row; its audit before is null', () => {
    const f = family()
    f.db.delete(periodDefaults).run()
    must(savePeriodDefaults(f.db, f.admin, NEW, SAVE_AT))
    expect(getPeriodDefaults(f.db)).toEqual(NEW)
    const [entry] = settingsAudit(f.db)
    expect(entry?.before).toBeNull()
    expect(json(entry?.after)).toEqual(asJson(NEW))
  })

  it("a giver's or a taker's save is refused", () => {
    const f = family()
    expect(savePeriodDefaults(f.db, f.tata, NEW, SAVE_AT)).toEqual({
      ok: false,
      error: 'not_admin',
    })
    expect(savePeriodDefaults(f.db, f.starsi, NEW, SAVE_AT)).toEqual({
      ok: false,
      error: 'not_admin',
    })
    expect(getPeriodDefaults(f.db)).toEqual(D)
    expect(settingsAudit(f.db)).toEqual([])
  })

  it.each([
    ['upper below lower', { ...NEW, levels: { lower: 60, upper: 50 } }],
    ['lower 0', { ...NEW, levels: { lower: 0, upper: 50 } }],
    ['10 days', { ...NEW, lengthDays: 10 }],
    ['0 days', { ...NEW, lengthDays: 0 }],
    ['371 days', { ...NEW, lengthDays: 371 }],
    ['weekday 7', { ...NEW, cutoff: { weekday: 7 as Weekday, hour: 20, minute: 0 } }],
  ])('invalid defaults write nothing: %s', (_name, defaults) => {
    const f = family()
    expect(savePeriodDefaults(f.db, f.admin, defaults, SAVE_AT)).toEqual({
      ok: false,
      error: 'invalid_settings',
    })
    expect(getPeriodDefaults(f.db)).toEqual(D)
    expect(settingsAudit(f.db)).toEqual([])
  })

  it.each([
    ['upper = lower', { ...NEW, levels: { lower: 70, upper: 70 } }],
    ['lower 1', { ...NEW, levels: { lower: 1, upper: 2 } }],
    ['7 days', { ...NEW, lengthDays: 7 }],
    ['364 days', { ...NEW, lengthDays: 364 }],
  ])('boundary accepted: %s', (_name, defaults) => {
    const f = family()
    must(savePeriodDefaults(f.db, f.admin, defaults, SAVE_AT))
    expect(getPeriodDefaults(f.db)).toEqual(defaults)
  })

  it('a failed audit write rolls the save back', () => {
    const f = family()
    failAuditOn(f.db, 'settings.changed')
    expect(() => savePeriodDefaults(f.db, f.admin, NEW, SAVE_AT)).toThrow(/audit down/)
    expect(getPeriodDefaults(f.db)).toEqual(D)
    expect(f.db.select().from(periodDefaults).get()?.updatedBy).toBeNull()
  })

  it('a save does not change the running period; the next roll uses it', () => {
    const f = family()
    rollPeriods(f.db, SAT, getPeriodDefaults(f.db))
    must(savePeriodDefaults(f.db, f.admin, NEW, SAVE_AT))
    expect(currentPeriod(f.db, SAVE_AT)).toMatchObject({
      cutoffAt: CUTOFF,
      levels: { lower: 50, upper: 100 },
    })
    const [next] = rollPeriods(f.db, plus(CUTOFF, 1), getPeriodDefaults(f.db))
    // 14 days from Sun 29 Nov 23:59 → the Saturday 20:00 nearest Sun 13 Dec 23:59: Sat 12 Dec.
    expect(next).toMatchObject({
      startsAt: CUTOFF,
      cutoffAt: prague(2026, 12, 12, 20),
      levels: { lower: 60, upper: 120 },
    })
  })

  it('a save after a missed cutoff does not reach the period that started at it', () => {
    const f = family()
    rollPeriods(f.db, SAT, getPeriodDefaults(f.db))
    // The roller has not ticked since the cutoff; the admin saves five minutes after it.
    const late = plus(CUTOFF, 5 * 60_000)
    must(savePeriodDefaults(f.db, f.admin, NEW, late))
    const all = listPeriods(f.db)
    expect(all).toHaveLength(2)
    expect(all[1]).toMatchObject({
      startsAt: CUTOFF,
      cutoffAt: prague(2026, 12, 6, 23, 59),
      levels: { lower: 50, upper: 100 },
    })
    // The roll it did is audited before the settings change.
    const actions = f.db
      .select({ action: auditLog.action })
      .from(auditLog)
      .orderBy(asc(auditLog.id))
      .all()
      .map((a) => a.action)
    expect(actions.slice(-2)).toEqual(['period.created', 'settings.changed'])
    // The period after it takes the saved defaults.
    const [third] = rollPeriods(f.db, prague(2026, 12, 7), getPeriodDefaults(f.db))
    expect(third).toMatchObject({ levels: { lower: 60, upper: 120 } })
  })

  it('a write by the system (an agreed proposal) stores no user and audits a system actor', () => {
    const f = family()
    f.db.transaction((tx) => {
      writePeriodDefaults(tx, { kind: 'system' }, NEW, SAVE_AT)
    })
    expect(getPeriodDefaults(f.db)).toEqual(NEW)
    expect(f.db.select().from(periodDefaults).get()?.updatedBy).toBeNull()
    expect(settingsAudit(f.db)[0]).toMatchObject({ actorKind: 'system', actorUserId: null })
  })
})
