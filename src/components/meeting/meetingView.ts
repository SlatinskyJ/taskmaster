import { parseIsoUtc, toPragueWallTime } from '~/domain/dates'
import type { Level } from '~/domain'
import { cs, formatPoints, plural } from '~/lib/strings'

// Labels for the weekly meeting screen (#44). All Prague wall time, from stored UTC instants.

const pad = (n: number) => String(n).padStart(2, '0')

function wall(iso: string) {
  return toPragueWallTime(parseIsoUtc(iso))
}

/** "29. 11.": the Prague day without the year. */
function dayMonth(iso: string): string {
  const t = wall(iso)
  return `${String(t.day)}. ${String(t.month)}.`
}

/** "22. 11. – 29. 11.": a week from its start day to its end (cutoff, or the early end). */
export function weekLabel(startsAt: string, endsAt: string): string {
  return `${dayMonth(startsAt)} – ${dayMonth(endsAt)}`
}

export function levelLabel(level: Level): string {
  return cs.meeting.level[level]
}

/**
 * The line under a taker who stayed below the lower level, or null. "Chyběly 3 body. Nic
 * nepropadá, 47 bodů jde do dalšího týdne." (spec §5.9: nothing is lost, it all carries over).
 */
export function shortfall(total: number, lower: number): string | null {
  if (total <= 0 || total >= lower) return null
  const missing = lower - total
  const m = cs.meeting
  return m.shortfall(
    formatPoints(missing),
    plural(missing, m.missingVerb),
    formatPoints(total),
    plural(total, m.goesVerb),
  )
}

/** "ne 29. 11. 20:00": short day, date and time (for "Vyúčtováno"). */
export function dayTime(iso: string): string {
  const t = wall(iso)
  return `${cs.bids.weekdays[t.weekday]} ${dayMonth(iso)} ${pad(t.hour)}:${pad(t.minute)}`
}

/** "neděle 29. 11. 23:59": the day name as it reads after "do" (the pending hint). */
export function untilLabel(iso: string): string {
  const t = wall(iso)
  return `${cs.meeting.untilDays[t.weekday]} ${dayMonth(iso)} ${pad(t.hour)}:${pad(t.minute)}`
}
