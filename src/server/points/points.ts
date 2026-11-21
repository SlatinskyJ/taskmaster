import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { DEFAULT_LEVELS } from '~/domain/periods'
import type { LedgerEntry, Levels } from '~/domain/settlement'
import { runningTotal } from '~/domain/settlement'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { tasks, users } from '~/server/db/schema'

// Points per taker (spec §5.7), read-only.
//
// `confirmed` is the running total (spec §5.9): confirmed points − deducted by settlements ±
// adjustments, computed by the domain's `runningTotal` over ledger entries. Today the only
// entries are completions (confirmed one-time tasks with an earner). Owners of the rest:
//   - #44 (weekly meeting) adds `settlement` entries, the points each settlement deducted;
//   - #48 (corrections, adjustments) adds `adjustment` entries;
//   - #42 (periods) takes `levels` from the current period instead of DEFAULT_LEVELS.
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

/** Every active taker, by user id, with confirmed and pending points. */
export function takerPoints(db: Db | Tx): PointsOverview {
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
    levels: DEFAULT_LEVELS,
    takers: takers.map((t) => ({
      id: t.id,
      name: t.name,
      confirmed: runningTotal(entries, t.id),
      pending: pending.get(t.id) ?? 0,
    })),
  }
}
