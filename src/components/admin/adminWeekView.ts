import type { AdminWeek } from '~/server/settlement/functions'

/**
 * A week not settled yet, so far (#263): the carry-in, his confirmed completions and the
 * adjustments made in the week count as confirmed; completions still waiting are pending.
 * The same split Týden's points bar shows for a running week (spec §5.7).
 */
export function weekSoFar(week: AdminWeek): { confirmed: number; pending: number } {
  let confirmed = week.carriedIn
  let pending = 0
  for (const item of week.items) {
    if (item.status === 'confirmed') confirmed += item.score
    else pending += item.score
  }
  for (const a of week.adjustments) confirmed += a.points
  return { confirmed, pending }
}
