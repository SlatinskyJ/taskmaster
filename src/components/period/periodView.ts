import {
  addPragueDays,
  parseIsoUtc,
  startOfPragueDay,
  toIsoUtc,
  toPragueWallTime,
} from '~/domain/dates'
import type { Level } from '~/domain'
import { cs } from '~/lib/strings'

// Labels for a week (period) and its settlement, shared by Schůzka (#44) and Týden (#45).
// All Prague wall time, from stored UTC instants.

export const pad = (n: number) => String(n).padStart(2, '0')

export function wall(iso: string) {
  return toPragueWallTime(parseIsoUtc(iso))
}

/** "29. 11.": the Prague day without the year. */
export function dayMonth(iso: string): string {
  const t = wall(iso)
  return `${String(t.day)}. ${String(t.month)}.`
}

/**
 * "22. 11. – 29. 11.": a week from its start day to its end (cutoff, or the early end).
 * An end at 00:00 Prague names the day before: nothing of the week happens on the end day.
 */
export function weekLabel(startsAt: string, endsAt: string): string {
  const end = parseIsoUtc(endsAt)
  const lastDay =
    startOfPragueDay(end).getTime() === end.getTime() ? toIsoUtc(addPragueDays(end, -1)) : endsAt
  return `${dayMonth(startsAt)} – ${dayMonth(lastDay)}`
}

export function levelLabel(level: Level): string {
  return cs.meeting.level[level]
}

/** "st 25. 11.": short day name and date. */
export function dayLabel(iso: string): string {
  return `${cs.weekdays[wall(iso).weekday]} ${dayMonth(iso)}`
}

/** "ne 29. 11. 20:00": short day, date and time (for "Vyúčtováno"). */
export function dayTime(iso: string): string {
  const t = wall(iso)
  return `${dayLabel(iso)} ${pad(t.hour)}:${pad(t.minute)}`
}

/** The level badge colours (theme state tokens). */
const LEVEL_BADGE: Record<Level, string> = {
  upper: 'bg-state-confirmed/15 text-state-confirmed-text',
  lower: 'bg-state-open/15 text-state-open-text',
  none: 'bg-state-cancelled/15 text-state-cancelled-text',
}

export function levelBadgeClass(level: Level): string {
  return LEVEL_BADGE[level]
}
