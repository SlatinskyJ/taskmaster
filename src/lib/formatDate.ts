import { parseIsoUtc, toPragueWallTime } from '~/domain/dates'
import { cs } from './strings'

/**
 * A stored UTC instant as the Prague calendar day, `d. M. yyyy` (Czech style). The same on
 * the server (UTC) and in the browser, so the server render and hydration agree.
 */
export function formatPragueDate(iso: string): string {
  const { day, month, year } = toPragueWallTime(parseIsoUtc(iso))
  return `${String(day)}. ${String(month)}. ${String(year)}`
}

/** A Prague clock time, `7:00`, `16:05`. */
export function formatPragueTime(iso: string): string {
  const { hour, minute } = toPragueWallTime(parseIsoUtc(iso))
  return `${String(hour)}:${String(minute).padStart(2, '0')}`
}

const DAY = 86_400_000
/** Whole Prague calendar days from `from` to `to`. */
function pragueDaysBetween(from: Date, to: Date): number {
  const a = toPragueWallTime(from)
  const b = toPragueWallTime(to)
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY,
  )
}

/**
 * An instance's due time from `now`: "do 7:00" today, "do zítra 7:00", "do st 7:00" later;
 * "po termínu" once its grace window has ended (half-open, as in the domain).
 */
export function formatDue(dueAt: string, graceEndsAt: string, now: Date): string {
  if (parseIsoUtc(graceEndsAt).getTime() <= now.getTime()) return cs.instances.overdue
  const due = parseIsoUtc(dueAt)
  const time = formatPragueTime(dueAt)
  const days = pragueDaysBetween(now, due)
  if (days <= 0) return cs.instances.dueToday(time)
  if (days === 1) return cs.instances.dueTomorrow(time)
  const weekday = cs.weekdays[toPragueWallTime(due).weekday]
  return cs.instances.dueOn(weekday, time)
}
