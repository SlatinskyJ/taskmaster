import { describe, expect, it } from 'vitest'
import type { Weekday } from './dates'
import { fromPragueWallTime } from './dates'
import {
  MAX_DUE_DAY_OFFSET,
  MAX_GRACE_MINUTES,
  instanceDeadline,
  validateTemplateDefinition,
} from './templates'

const SIX_PM = { hour: 18, minute: 0 }
const SEVEN_AM = { hour: 7, minute: 0 }

const withSchedule = (days: number[], time: { hour: number; minute: number } | null = SIX_PM) =>
  // Out-of-range days on purpose: the server function's input is only type-checked.
  validateTemplateDefinition({ schedule: { days: days as Weekday[], time }, deadline: null })

const withDeadline = (
  dayOffset: number,
  due: { hour: number; minute: number },
  graceMinutes: number,
) => validateTemplateDefinition({ schedule: null, deadline: { dayOffset, due, graceMinutes } })

describe('validateTemplateDefinition (spec §5.3)', () => {
  it('accepts a template with no schedule and no deadline (on demand only)', () => {
    expect(validateTemplateDefinition({ schedule: null, deadline: null })).toEqual({
      ok: true,
      value: { schedule: null, deadline: null },
    })
  })

  it('sorts and de-duplicates the days', () => {
    expect(withSchedule([2, 2, 5])).toEqual({
      ok: true,
      value: { schedule: { days: [2, 5], time: SIX_PM }, deadline: null },
    })
  })

  it('accepts a schedule without a time', () => {
    expect(withSchedule([0, 6], null)).toEqual({
      ok: true,
      value: { schedule: { days: [0, 6], time: null }, deadline: null },
    })
  })

  it.each([[[]], [[7]], [[-1]], [[1.5]]])('refuses days %j', (days) => {
    expect(withSchedule(days)).toEqual({ ok: false, error: 'invalid_schedule' })
  })

  it.each([
    [{ hour: 24, minute: 0 }],
    [{ hour: 18, minute: 60 }],
    [{ hour: 18.5, minute: 0 }],
    [{ hour: -1, minute: 0 }],
  ])('refuses schedule time %j', (time) => {
    expect(withSchedule([2], time)).toEqual({ ok: false, error: 'invalid_schedule' })
  })

  it('day offset boundaries: 0 and 6 ok, -1 and 7 refused', () => {
    expect(MAX_DUE_DAY_OFFSET).toBe(6)
    expect(withDeadline(0, SEVEN_AM, 120).ok).toBe(true)
    expect(withDeadline(6, SEVEN_AM, 120).ok).toBe(true)
    expect(withDeadline(7, SEVEN_AM, 120)).toEqual({ ok: false, error: 'invalid_deadline' })
    expect(withDeadline(-1, SEVEN_AM, 120)).toEqual({ ok: false, error: 'invalid_deadline' })
    expect(withDeadline(1.5, SEVEN_AM, 120)).toEqual({ ok: false, error: 'invalid_deadline' })
  })

  it('grace boundaries: 0 and 48 h ok, -1 and 48 h + 1 min refused', () => {
    expect(MAX_GRACE_MINUTES).toBe(2880)
    expect(withDeadline(1, SEVEN_AM, 0).ok).toBe(true)
    expect(withDeadline(1, SEVEN_AM, 2880).ok).toBe(true)
    expect(withDeadline(1, SEVEN_AM, 2881)).toEqual({ ok: false, error: 'invalid_deadline' })
    expect(withDeadline(1, SEVEN_AM, -1)).toEqual({ ok: false, error: 'invalid_deadline' })
  })

  it('due time: 23:59 ok, 24:00 refused', () => {
    expect(withDeadline(1, { hour: 23, minute: 59 }, 0).ok).toBe(true)
    expect(withDeadline(1, { hour: 24, minute: 0 }, 0)).toEqual({
      ok: false,
      error: 'invalid_deadline',
    })
  })

  it('a deadline without a schedule is accepted (on-demand instances, #38)', () => {
    expect(withDeadline(1, SEVEN_AM, 120)).toEqual({
      ok: true,
      value: { schedule: null, deadline: { dayOffset: 1, due: SEVEN_AM, graceMinutes: 120 } },
    })
  })
})

describe('instanceDeadline (spec §5.3 deadline rule)', () => {
  const prague = (month: number, day: number, hour: number, minute = 0) =>
    fromPragueWallTime({ year: 2026, month, day, hour, minute })
  const rule = (dayOffset: number, hour: number, minute: number, graceMinutes = 60) => ({
    dayOffset,
    due: { hour, minute },
    graceMinutes,
  })

  it('"next day, 7:00" from Tuesday 18:00 is due Wednesday 7:00, grace one hour later', () => {
    const d = instanceDeadline(rule(1, 7, 0), prague(11, 24, 18))
    expect(d.dueAt.toISOString()).toBe('2026-11-25T06:00:00.000Z')
    expect(d.graceEndsAt.toISOString()).toBe('2026-11-25T07:00:00.000Z')
  })

  it('"same day, 7:00" made at 06:59 is due the same day', () => {
    expect(instanceDeadline(rule(0, 7, 0), prague(11, 24, 6, 59)).dueAt).toEqual(prague(11, 24, 7))
  })

  it('"same day, 7:00" made at exactly 07:00 is due the next day', () => {
    expect(instanceDeadline(rule(0, 7, 0), prague(11, 24, 7)).dueAt).toEqual(prague(11, 25, 7))
  })

  it('"same day, 7:00" made at 07:30 is due the next day', () => {
    expect(instanceDeadline(rule(0, 7, 0), prague(11, 24, 7, 30)).dueAt).toEqual(prague(11, 25, 7))
  })

  it('keeps the Prague clock time across the March switch', () => {
    const d = instanceDeadline(rule(1, 7, 0), prague(3, 28, 18))
    expect(d.dueAt.toISOString()).toBe('2026-03-29T05:00:00.000Z')
  })

  it('keeps the Prague clock time across the October switch', () => {
    const d = instanceDeadline(rule(1, 7, 0), prague(10, 24, 18))
    expect(d.dueAt.toISOString()).toBe('2026-10-25T06:00:00.000Z')
  })

  it('grace 0 ends at the due time', () => {
    const d = instanceDeadline(rule(1, 7, 0, 0), prague(11, 24, 18))
    expect(d.graceEndsAt).toEqual(d.dueAt)
  })

  it('a due time in the March gap moves forward on that day only', () => {
    // 2:30 does not exist on 2026-03-29; it becomes 3:30 CEST (01:30Z).
    expect(instanceDeadline(rule(0, 2, 30), prague(3, 29, 3)).dueAt.toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    )
    // Made after that: the next day at 2:30 CEST (00:30Z), not 3:30.
    expect(instanceDeadline(rule(0, 2, 30), prague(3, 29, 3, 45)).dueAt.toISOString()).toBe(
      '2026-03-30T00:30:00.000Z',
    )
  })
})
