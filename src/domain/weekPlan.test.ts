import { describe, expect, it } from 'vitest'
import { fromPragueWallTime, toIsoUtc } from './dates'
import { copyInWeek, copySlot } from './weekPlan'

// Which week copies are in a period's plan (#258, spec §5.12).

const at = (month: number, day: number, hour = 0, minute = 0) =>
  fromPragueWallTime({ year: 2026, month, day, hour, minute })
const SUN = toIsoUtc(at(11, 29))
const MON = toIsoUtc(at(11, 30))
/** A week started early by a meeting on Sunday 29. 11. 20:00, cutoff Sunday 6. 12. 23:59. */
const WEEK = { startsAt: at(11, 29, 20), cutoffAt: at(12, 6, 23, 59) }
const scheduled = (planDayAt: string, createdAt = toIsoUtc(at(11, 23))) => ({
  planDayAt,
  origin: 'scheduled' as const,
  createdAt,
})

describe('copySlot', () => {
  it('a scheduled copy: its day at the schedule time, or the day start with no time', () => {
    expect(copySlot(scheduled(SUN), { hour: 21, minute: 0 })).toEqual(at(11, 29, 21))
    expect(copySlot(scheduled(SUN), null)).toEqual(at(11, 29))
  })

  it('an on-demand copy: when it was made', () => {
    const made = toIsoUtc(at(11, 29, 20, 30))
    expect(copySlot({ planDayAt: SUN, origin: 'on_demand', createdAt: made }, null)).toEqual(
      at(11, 29, 20, 30),
    )
  })
})

describe('copyInWeek', () => {
  it('a later day of the week is in, whatever its slot', () => {
    expect(copyInWeek(scheduled(MON), { hour: 6, minute: 0 }, WEEK)).toBe(true)
  })

  it('start day: a slot after the early start is in (spec: Sunday 21:00), one before is out (Sunday 10:00)', () => {
    expect(copyInWeek(scheduled(SUN), { hour: 21, minute: 0 }, WEEK)).toBe(true)
    expect(copyInWeek(scheduled(SUN), { hour: 10, minute: 0 }, WEEK)).toBe(false)
  })

  it('start day: a slot exactly at the start is in, a minute before is out', () => {
    expect(copyInWeek(scheduled(SUN), { hour: 20, minute: 0 }, WEEK)).toBe(true)
    expect(copyInWeek(scheduled(SUN), { hour: 19, minute: 59 }, WEEK)).toBe(false)
  })

  it('start day: a no-time copy (slot 00:00) is the old week’s', () => {
    expect(copyInWeek(scheduled(SUN), null, WEEK)).toBe(false)
  })

  it('start day: an on-demand copy is in when made at the start or later, out 1 ms before', () => {
    const od = (createdAt: Date) => ({
      planDayAt: SUN,
      origin: 'on_demand' as const,
      createdAt: toIsoUtc(createdAt),
    })
    expect(copyInWeek(od(WEEK.startsAt), null, WEEK)).toBe(true)
    expect(copyInWeek(od(new Date(WEEK.startsAt.getTime() - 1)), null, WEEK)).toBe(false)
  })

  it('a 00:00 start keeps every copy of its first day', () => {
    const week = { startsAt: at(11, 30), cutoffAt: at(12, 6, 23, 59) }
    expect(copyInWeek(scheduled(MON), null, week)).toBe(true)
  })

  it('a day before the start day, or one starting at or after the cutoff, is out', () => {
    expect(copyInWeek(scheduled(toIsoUtc(at(11, 28))), null, WEEK)).toBe(false)
    const toMonday = { startsAt: at(11, 30), cutoffAt: at(12, 7) }
    expect(copyInWeek(scheduled(toIsoUtc(at(12, 7))), null, toMonday)).toBe(false)
    expect(copyInWeek(scheduled(toIsoUtc(at(12, 6))), null, toMonday)).toBe(true)
  })
})
