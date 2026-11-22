import type { Levels, PeriodDefaults } from '~/domain'
import type { Weekday } from '~/domain/dates'
import { MAX_LENGTH_DAYS } from '~/domain/periods'
import { LEVEL_MAX } from '~/lib/periodLimits'

// The Výchozí týden form's rules, framework-free so they are tested without a DOM.

/** Monday first, as Czech calendars show the week (domain weekdays: 0 = Sunday). */
export const WEEKDAY_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0]

/** `HH:MM`, for the time input. */
export function toTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** The time input's value; null when empty or not `HH:MM`. */
export function fromTime(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  return hour <= 23 && minute <= 59 ? { hour, minute } : null
}

export function sameDefaults(a: PeriodDefaults, b: PeriodDefaults): boolean {
  return (
    a.lengthDays === b.lengthDays &&
    a.cutoff.weekday === b.cutoff.weekday &&
    a.cutoff.hour === b.cutoff.hour &&
    a.cutoff.minute === b.cutoff.minute &&
    a.levels.lower === b.levels.lower &&
    a.levels.upper === b.levels.upper
  )
}

/** One week longer or shorter, within 7 … MAX_LENGTH_DAYS. */
export function stepLength(d: PeriodDefaults, weeks: 1 | -1): PeriodDefaults {
  const lengthDays = Math.min(MAX_LENGTH_DAYS, Math.max(7, d.lengthDays + weeks * 7))
  return { ...d, lengthDays }
}

export const canShorten = (d: PeriodDefaults) => d.lengthDays > 7
export const canLengthen = (d: PeriodDefaults) => d.lengthDays < MAX_LENGTH_DAYS

/** A new lower level; raising it above the upper one pushes the upper one up with it. */
export function setLower<T extends { levels: Levels }>(d: T, lower: number): T {
  const l = Math.min(LEVEL_MAX, Math.max(1, lower))
  return { ...d, levels: { lower: l, upper: Math.max(l, d.levels.upper) } }
}

/** A new upper level, never below the lower one. */
export function setUpper<T extends { levels: Levels }>(d: T, upper: number): T {
  const u = Math.min(LEVEL_MAX, Math.max(d.levels.lower, upper))
  return { ...d, levels: { ...d.levels, upper: u } }
}
