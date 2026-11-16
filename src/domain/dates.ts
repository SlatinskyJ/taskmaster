import { TZDate, tzOffset } from '@date-fns/tz'

// The one place for wall-clock maths (spec §8, §11 Dates). Schedules, deadlines and period
// cutoffs are defined in Prague time; the DB stores UTC instants (ISO 8601, `Z`).
// Every function takes and returns plain `Date` instants; Prague only matters inside.
//
// DST rules (ours, pinned by tests; independent of the host's own time zone):
// - a wall time that doesn't exist (spring forward, 02:00–02:59 on the last Sunday of March)
//   moves forward by the gap: 02:30 → 03:30 CEST;
// - a wall time that happens twice (fall back, 02:00–02:59 on the last Sunday of October)
//   resolves to the second occurrence, in winter time (CET).

export const APP_TIME_ZONE = 'Europe/Prague'

/** 0 = Sunday … 6 = Saturday (same as `Date#getDay`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** A Prague wall-clock time. `month` is 1–12 (not JS's 0–11). */
export interface PragueWallTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function inPrague(instant: Date): TZDate {
  return new TZDate(instant.getTime(), APP_TIME_ZONE)
}

const HOUR = 3_600_000

/** Prague's UTC offset at an instant, in ms (+1 h in winter, +2 h in summer). */
function offsetAt(ms: number): number {
  return tzOffset(APP_TIME_ZONE, new Date(ms)) * 60_000
}

/** The UTC instant of a Prague wall time (see the DST rules above). */
export function fromPragueWallTime(w: PragueWallTime): Date {
  // The wall time read as if it were UTC; normalises overflow (day 32 → next month).
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute)
  // Offsets a few hours either side cover both sides of any DST switch.
  const before = offsetAt(asUtc - 3 * HOUR)
  const after = offsetAt(asUtc + 3 * HOUR)
  const matches = [...new Set([before, after])]
    .map((offset) => asUtc - offset)
    .filter((ms) => asUtc - ms === offsetAt(ms))
  // Fall back: two matches, take the later one (winter time). Gap: none, shift forward.
  return new Date(matches.length > 0 ? Math.max(...matches) : asUtc - before)
}

/** What a Prague clock and calendar show at this instant. */
export function toPragueWallTime(instant: Date): PragueWallTime & { weekday: Weekday } {
  const p = inPrague(instant)
  return {
    year: p.getFullYear(),
    month: p.getMonth() + 1,
    day: p.getDate(),
    hour: p.getHours(),
    minute: p.getMinutes(),
    weekday: p.getDay() as Weekday,
  }
}

/** Midnight in Prague on the day this instant falls on. */
export function startOfPragueDay(instant: Date): Date {
  const { year, month, day } = toPragueWallTime(instant)
  return fromPragueWallTime({ year, month, day, hour: 0, minute: 0 })
}

/**
 * Same Prague wall time, `days` calendar days later (or earlier). Across a DST switch the
 * result is 23 or 25 hours per day away, not 24: a 7-day period from Sunday 18:00 ends on
 * Sunday 18:00.
 */
export function addPragueDays(instant: Date, days: number): Date {
  const w = toPragueWallTime(instant)
  return fromPragueWallTime({ ...w, day: w.day + days })
}

/**
 * The first instant strictly after `after` that is `weekday` at `hour:minute` Prague time.
 * Used for schedules and the default cutoff (Sunday 18:00).
 */
export function nextPragueWeekdayAt(after: Date, weekday: Weekday, hour: number, minute = 0): Date {
  const now = toPragueWallTime(after)
  const daysAhead = (weekday - now.weekday + 7) % 7
  for (const offset of [daysAhead, daysAhead + 7]) {
    const day = toPragueWallTime(addPragueDays(startOfPragueDay(after), offset))
    const candidate = fromPragueWallTime({ ...day, hour, minute })
    if (candidate.getTime() > after.getTime()) return candidate
  }
  // Unreachable: a week later is always after `after`.
  throw new Error('nextPragueWeekdayAt: no candidate found')
}

/** Serialises an instant for the DB: ISO 8601 UTC with milliseconds. */
export function toIsoUtc(instant: Date): string {
  if (Number.isNaN(instant.getTime())) throw new RangeError('Invalid date')
  return instant.toISOString()
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** Parses a value written by `toIsoUtc`. Anything else (no `Z`, no ms, garbage) throws. */
export function parseIsoUtc(value: string): Date {
  const date = new Date(value)
  if (!ISO_UTC.test(value) || Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new RangeError(`Not an ISO UTC instant: ${value}`)
  }
  return date
}
