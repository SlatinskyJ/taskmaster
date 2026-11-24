import { asc, desc, eq, inArray } from 'drizzle-orm'
import type { SettlementCorrection } from '~/domain'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { settlementCorrections, settlements } from '~/server/db/schema'
import type { SettlementCorrectionRow, SettlementRow } from '~/server/db/schema'

// The read of correction rows (#48). A leaf: only the schema and the domain, so the dispute
// targets can read a settlement's effective value without importing the write path.

/** The newest correction of a settlement (the last one written, by id), or null. */
export function latestCorrection(
  db: Db | Tx,
  settlementId: number,
): SettlementCorrectionRow | null {
  return (
    db
      .select()
      .from(settlementCorrections)
      .where(eq(settlementCorrections.settlementId, settlementId))
      .orderBy(desc(settlementCorrections.id))
      .get() ?? null
  )
}

/** A correction row as the domain's `SettlementCorrection` of the given settlement. */
export function toCorrection(
  original: SettlementRow,
  row: SettlementCorrectionRow,
): SettlementCorrection {
  return {
    periodId: original.periodId,
    takerId: original.takerId,
    originalLevel: original.level,
    originalDeducted: original.deducted,
    correctedLevel: row.level,
    correctedDeducted: row.deducted,
    reason: row.reason,
  }
}

/** The newest correction of each given settlement (highest id), by settlement id. */
export function latestCorrections(
  db: Db | Tx,
  settlementIds: readonly number[],
): Map<number, SettlementCorrectionRow> {
  const out = new Map<number, SettlementCorrectionRow>()
  if (settlementIds.length === 0) return out
  for (const row of db
    .select()
    .from(settlementCorrections)
    .where(inArray(settlementCorrections.settlementId, [...settlementIds]))
    .orderBy(asc(settlementCorrections.id))
    .all()) {
    out.set(row.settlementId, row)
  }
  return out
}

/** The settled period each given correction corrected, by correction id. */
export function correctionPeriods(
  db: Db | Tx,
  correctionIds: readonly number[],
): Map<number, number> {
  if (correctionIds.length === 0) return new Map()
  return new Map(
    db
      .select({ id: settlementCorrections.id, periodId: settlements.periodId })
      .from(settlementCorrections)
      .innerJoin(settlements, eq(settlements.id, settlementCorrections.settlementId))
      .where(inArray(settlementCorrections.id, [...correctionIds]))
      .all()
      .map((r) => [r.id, r.periodId]),
  )
}
