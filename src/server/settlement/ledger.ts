import { and, eq, isNotNull, lt } from 'drizzle-orm'
import { runningTotal } from '~/domain'
import type { LedgerEntry } from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { pointAdjustments, settlements, tasks } from '~/server/db/schema'

// The records a running total is built from (spec §5.9, §5.10): confirmed completions credited
// to their earner, every settlement's deduction, and every point adjustment (#48: manual, or a
// settlement correction's difference). A completion belongs to the period of its `completed_at`,
// not its approval time (spec §5.5), and an adjustment to the period of its `made_at`, so
// `until` filters on those and is exclusive.

/**
 * Ledger entries for every taker. With `until`: only completions done and adjustments made
 * before it; settlements are always all of them (the meeting settles the oldest week first, so none is later).
 */
export function ledgerEntries(db: Db | Tx, until?: Date): LedgerEntry[] {
  const done = db
    .select({ earnerId: tasks.earnerId, score: tasks.score })
    .from(tasks)
    .where(
      and(
        eq(tasks.status, 'confirmed'),
        isNotNull(tasks.earnerId),
        until ? lt(tasks.completedAt, toIsoUtc(until)) : undefined,
      ),
    )
    .all()
  const entries: LedgerEntry[] = []
  for (const t of done) {
    if (t.earnerId !== null)
      entries.push({ kind: 'completion', takerId: t.earnerId, points: t.score })
  }
  for (const s of db
    .select({ takerId: settlements.takerId, deducted: settlements.deducted })
    .from(settlements)
    .all()) {
    entries.push({ kind: 'settlement', takerId: s.takerId, deducted: s.deducted })
  }
  for (const a of db
    .select({ takerId: pointAdjustments.takerId, points: pointAdjustments.points })
    .from(pointAdjustments)
    .where(until ? lt(pointAdjustments.madeAt, toIsoUtc(until)) : undefined)
    .all()) {
    entries.push({ kind: 'adjustment', takerId: a.takerId, points: a.points })
  }
  return entries
}

/**
 * Each taker's points now (spec §5.7): confirmed = the running total (carry-over + confirmed
 * since), pending = the scores done and waiting for a giver, keyed by earner. Takers with neither
 * are missing from the map (read as 0). The one points read: Týden and Domů (`takerPoints`) use
 * it.
 */
export function takerPointsNow(db: Db | Tx): Map<number, { confirmed: number; pending: number }> {
  const entries = ledgerEntries(db)
  const out = new Map<number, { confirmed: number; pending: number }>()
  const at = (id: number) => {
    let p = out.get(id)
    if (!p) {
      p = { confirmed: runningTotal(entries, id), pending: 0 }
      out.set(id, p)
    }
    return p
  }
  for (const e of entries) at(e.takerId)
  for (const t of db
    .select({ earnerId: tasks.earnerId, score: tasks.score })
    .from(tasks)
    .where(and(eq(tasks.status, 'done_unconfirmed'), isNotNull(tasks.earnerId)))
    .all()) {
    if (t.earnerId !== null) at(t.earnerId).pending += t.score
  }
  return out
}
