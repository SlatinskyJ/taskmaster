import { and, asc, eq } from 'drizzle-orm'
import type { Role } from '~/domain/parties'
import type { Levels } from '~/domain/settlement'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { users } from '~/server/db/schema'
import { getPeriodDefaults } from '~/server/periods/defaults'
import { currentLevels } from '~/server/periods/periods'
import { takerPointsNow } from '~/server/settlement/ledger'

// Points per taker (spec §5.7), read-only.
//
// `confirmed` and `pending` come from `takerPointsNow`, the one points read (Týden uses it too):
// confirmed is the running total (spec §5.9), confirmed completions minus what each settlement
// deducted; #48 (corrections, adjustments) adds `adjustment` entries there. `pending` is the sum
// of the taker's done, unconfirmed tasks. A task a giver did himself has no earner and counts for
// nobody. This adds every active taker (a zero row when he has neither) and the levels: the
// running period's; when none runs (`currentLevels`), the agreed change for the next period, else
// the stored defaults.

export interface TakerPoints {
  id: number
  name: string
  confirmed: number
  pending: number
}

export interface PointsOverview {
  levels: Levels
  takers: TakerPoints[]
}

/** Every active taker, by user id, with confirmed and pending points, and the levels at `now`. */
export function takerPoints(db: Db | Tx, now: Date): PointsOverview {
  const takers = db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(and(eq(users.role, 'taker'), eq(users.active, true)))
    .orderBy(asc(users.id))
    .all()
  const points = takerPointsNow(db)
  return {
    levels: currentLevels(db, now, getPeriodDefaults(db)),
    takers: takers.map((t) => ({
      id: t.id,
      name: t.name,
      confirmed: points.get(t.id)?.confirmed ?? 0,
      pending: points.get(t.id)?.pending ?? 0,
    })),
  }
}

/** What one person may see (spec §5.7): a taker only his own row, a giver every taker. */
export function pointsView(
  db: Db | Tx,
  viewer: { id: number; role: Role },
  now: Date,
): PointsOverview {
  const overview = takerPoints(db, now)
  if (viewer.role !== 'taker') return overview
  return { ...overview, takers: overview.takers.filter((t) => t.id === viewer.id) }
}
