import { dayMonth, pad, wall } from '~/components/period/periodView'
import { cs, formatPoints, plural } from '~/lib/strings'

// Labels only the weekly meeting screen (#44) uses. Shared week labels: ../period/periodView.

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

/** "neděle 29. 11. 23:59": the day name as it reads after "do" (the pending hint). */
export function untilLabel(iso: string): string {
  const t = wall(iso)
  return `${cs.meeting.untilDays[t.weekday]} ${dayMonth(iso)} ${pad(t.hour)}:${pad(t.minute)}`
}
