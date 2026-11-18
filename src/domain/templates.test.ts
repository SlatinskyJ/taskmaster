import { describe, expect, it } from 'vitest'
import type { Weekday } from './dates'
import { MAX_DUE_DAY_OFFSET, MAX_GRACE_MINUTES, validateTemplateDefinition } from './templates'

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
