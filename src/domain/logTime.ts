import { addPragueDays, fromPragueWallTime, toPragueWallTime } from './dates'

// Zapsat's "Kdy?" (#38, Jakub 2026-11-22): a boy may say he did the chore earlier. The log's
// completion time decides which week it counts in (spec §5.8), so a past choice never reaches
// back before the running week's start: a settled week stays settled.
//
// [call] "Dnes ráno" = today 7:00 Prague, "Včera" = yesterday 18:00 Prague.

export const LOG_WHEN = ['now', 'this_morning', 'yesterday'] as const
export type LogWhen = (typeof LOG_WHEN)[number]

const MORNING = 7
const EVENING = 18

/** The completion instant a choice stands for. */
export function logInstant(when: LogWhen, now: Date): Date {
  if (when === 'now') return now
  const day = toPragueWallTime(when === 'this_morning' ? now : addPragueDays(now, -1))
  return fromPragueWallTime({
    year: day.year,
    month: day.month,
    day: day.day,
    hour: when === 'this_morning' ? MORNING : EVENING,
    minute: 0,
  })
}

/**
 * The choices open at `now`: "now" always; a past one only when it is before now and not before
 * `weekStart` (the running week's start; null when none runs yet, then only "now").
 */
export function logChoices(now: Date, weekStart: Date | null): LogWhen[] {
  return LOG_WHEN.filter((when) => {
    if (when === 'now') return true
    if (!weekStart) return false
    const at = logInstant(when, now).getTime()
    return at < now.getTime() && at >= weekStart.getTime()
  })
}
