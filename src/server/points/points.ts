import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import type { Role } from '~/domain/parties'
import type { LedgerEntry, Levels } from '~/domain/settlement'
import { runningTotal } from '~/domain/settlement'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { tasks, users } from '~/server/db/schema'
import { getPeriodDefaults } from '~/server/periods/defaults'
import { currentLevels } from '~/server/periods/periods'

// Points per taker (spec §5.7), read-only.
//
// `confirmed` is the running total (spec §5.9): confirmed points − deducted by settlements ±
// adjustments, computed by the domain's `runningTotal` over ledger entries. Today the only
// entries are completions (confirmed tasks with an earner, one-time or instance). Owners of the rest:
//   - #172 (points subtract settlements) switches this to #44's `ledgerEntries`, which adds
//     `settlement` entries, the points each settlement deducted;
//   - #48 (corrections, adjustments) adds `adjustment` entries;
// `levels` are the running period's; when none runs (`currentLevels`), the agreed change for the
// next period, else the stored defaults.
// `pending` is the sum of the taker's done, unconfirmed tasks. A task a giver did himself has
// no earner and counts for nobody.

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
  const rows = db
    .select({ earnerId: tasks.earnerId, status: tasks.status, score: tasks.score })
    .from(tasks)
    .where(and(inArray(tasks.status, ['confirmed', 'done_unconfirmed']), isNotNull(tasks.earnerId)))
    .all()
  const entries: LedgerEntry[] = []
  const pending = new Map<number, number>()
  for (const r of rows) {
    if (r.earnerId === null) continue
    if (r.status === 'confirmed') {
      entries.push({ kind: 'completion', takerId: r.earnerId, points: r.score })
    } else {
      pending.set(r.earnerId, (pending.get(r.earnerId) ?? 0) + r.score)
    }
  }
  return {
    levels: currentLevels(db, now, getPeriodDefaults(db)),
    takers: takers.map((t) => ({
      id: t.id,
      name: t.name,
      confirmed: runningTotal(entries, t.id),
      pending: pending.get(t.id) ?? 0,
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
