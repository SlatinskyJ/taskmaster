import { desc, eq } from 'drizzle-orm'
import type { SettlementCorrection } from '~/domain'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { settlementCorrections } from '~/server/db/schema'
import type { SettlementCorrectionRow, SettlementRow } from '~/server/db/schema'

// The read of correction rows (#48). A leaf: only the schema and the domain, so the dispute
// targets can read a settlement's effective value without importing the write path.

/** The newest correction of a settlement (by `made_at`, then id), or null. */
export function latestCorrection(
  db: Db | Tx,
  settlementId: number,
): SettlementCorrectionRow | null {
  return (
    db
      .select()
      .from(settlementCorrections)
      .where(eq(settlementCorrections.settlementId, settlementId))
      .orderBy(desc(settlementCorrections.madeAt), desc(settlementCorrections.id))
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
