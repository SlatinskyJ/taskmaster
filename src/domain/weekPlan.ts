import { fromPragueWallTime, parseIsoUtc, startOfPragueDay, toPragueWallTime } from './dates'
import type { ClockTime } from './templates'

// Which week copies are in a period's plan (spec §5.12): "a copy belongs to the period its slot
// falls in". Every day of the period after its start day is the period's. On the start day a
// copy is in only if its slot is at or after the start: after a Sunday 20:00 meeting the Sunday
// 21:00 copy (made by the old week) is in the new week, a Sunday 10:00 one is not.
//
// A copy keeps no slot of its own, so it is rebuilt: a scheduled copy's day at the template's
// schedule time (no time: the day's 00:00, so a no-time start-day copy is the old week's); an
// on-demand copy's slot is when it was made. A schedule time changed after the copy was made
// shifts this rebuilt slot (a known gap, listed in the PR brief for Jakub).

export interface WeekCopyTimes {
  /** UTC ISO start of the copy's Prague day. */
  planDayAt: string
  origin: 'scheduled' | 'on_demand'
  /** UTC ISO: when the copy was made. */
  createdAt: string
}

/** The copy's slot: see above. `time` is its template's schedule time. */
export function copySlot(copy: WeekCopyTimes, time: ClockTime | null): Date {
  if (copy.origin === 'on_demand') return parseIsoUtc(copy.createdAt)
  const day = toPragueWallTime(parseIsoUtc(copy.planDayAt))
  return fromPragueWallTime({
    year: day.year,
    month: day.month,
    day: day.day,
    hour: time?.hour ?? 0,
    minute: time?.minute ?? 0,
  })
}

/** Whether the copy is in the period's plan. */
export function copyInWeek(
  copy: WeekCopyTimes,
  time: ClockTime | null,
  period: { startsAt: Date; cutoffAt: Date },
): boolean {
  const day = parseIsoUtc(copy.planDayAt).getTime()
  const startDay = startOfPragueDay(period.startsAt).getTime()
  if (day < startDay || day >= period.cutoffAt.getTime()) return false
  if (day > startDay) return true
  return copySlot(copy, time).getTime() >= period.startsAt.getTime()
}
