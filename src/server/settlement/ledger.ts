import { and, eq, isNotNull, lt } from 'drizzle-orm'
import type { LedgerEntry } from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { settlements, tasks } from '~/server/db/schema'

// The records a running total is built from (spec §5.9, §5.10): confirmed completions credited
// to their earner, and every settlement's deduction. Adjustments join when the admin screen
// (#47/#36) stores them. A completion belongs to the period of its `completed_at`, not its
// approval time (spec §5.5), so `until` filters on `completed_at` and is exclusive.

/**
 * Ledger entries for every taker. With `until`: only completions done before it; settlements
 * are always all of them (the meeting settles the oldest week first, so none is later).
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
  return entries
}
