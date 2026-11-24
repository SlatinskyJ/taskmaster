import { and, eq } from 'drizzle-orm'
import { adjustPoints, correctDispute, correctSettlement, fail, ok } from '~/domain'
import type {
  Dispute,
  DisputeCorrection,
  DisputeError,
  Level,
  Result,
  SettlementError,
} from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import { writeAudit } from '~/server/audit'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import {
  disputes,
  periods,
  pointAdjustments,
  settlementCorrections,
  settlements,
} from '~/server/db/schema'
import { loadTarget, plain, refOf, valueMoved } from '~/server/disputes'
import type { DisputeValue } from '~/server/disputes'
import { takerPointsNow, weekWaiting } from '~/server/settlement'
import { listPeople } from '~/server/users/people'
import { latestCorrection, toCorrection } from './read'

// The admin corrects a final settlement or adjusts points by hand (spec §5.9, #48), directly or
// to resolve a dispute (§5.11). The rules are the domain's `adjustPoints`, `correctSettlement`
// and `correctDispute`; this module loads what they need, runs them and writes the rows with
// their audit entries in one transaction. The settlement row itself is never touched.

export type FixError =
  SettlementError | DisputeError | 'not_found' | 'value_changed' | 'week_waiting'

/** The dispute a fix resolves, with the item's value the admin saw. */
export interface FromDispute {
  disputeId: number
  seen: DisputeValue | null
}

/** Thrown inside a transaction to roll it back; mapped to its error outside. */
class Refused extends Error {
  constructor(readonly error: FixError) {
    super(error)
  }
}

function inTx<T>(db: Db | Tx, run: (tx: Tx) => Result<T, FixError>): Result<T, FixError> {
  try {
    return db.transaction(run)
  } catch (err) {
    if (err instanceof Refused) return fail(err.error)
    throw err
  }
}

const currentTotal = (tx: Tx, takerId: number) => takerPointsNow(tx).get(takerId)?.confirmed ?? 0

interface OpenDispute {
  dispute: Dispute
  value: DisputeValue | null
}

/** The open dispute a fix resolves, checked against the value the admin saw. */
function openDispute(tx: Tx, from: FromDispute): Result<OpenDispute, FixError> {
  const row = tx.select().from(disputes).where(eq(disputes.id, from.disputeId)).get()
  const loaded = row ? loadTarget(tx, { kind: row.itemKind, id: row.itemId }) : null
  if (!row || !loaded) return fail('not_found')
  if (row.status !== 'open') return fail('not_open')
  const value = plain(loaded.value)
  if (valueMoved(from.seen, value)) return fail('value_changed')
  const dispute: Dispute = {
    item: refOf(loaded.target),
    openedBy: row.openedBy,
    reason: row.reason,
    status: 'open',
  }
  return ok({ dispute, value })
}

/** Closes the dispute as corrected (`where status = 'open'`) with its audit entry. */
function closeCorrected(
  tx: Tx,
  adminId: number,
  open: OpenDispute,
  disputeId: number,
  correction: DisputeCorrection,
  link: { kind: 'settlement_correction' | 'adjustment'; id: number },
  note: string,
  now: Date,
): void {
  const closed = correctDispute(open.dispute, listPeople(tx), adminId, correction, note)
  if (!closed.ok) throw new Refused(closed.error)
  if (closed.value.status !== 'corrected') throw new Error('correctDispute: not corrected')
  const text = closed.value.note
  const changed = tx
    .update(disputes)
    .set({ status: 'corrected', resolvedBy: adminId, resolvedAt: toIsoUtc(now), note: text })
    .where(and(eq(disputes.id, disputeId), eq(disputes.status, 'open')))
    .run()
  if (changed.changes !== 1) throw new Refused('not_open')
  writeAudit(tx, {
    actor: { kind: 'user', userId: adminId },
    action: 'dispute.corrected',
    entityType: 'dispute',
    entityId: disputeId,
    before: { status: 'open' },
    after: { status: 'corrected', note: text, value: open.value, correction: link },
    at: now,
  })
}

function insertAdjustment(
  tx: Tx,
  adminId: number,
  a: { takerId: number; points: number; reason: string },
  links: { correctionId: number | null; disputeId: number | null },
  now: Date,
): number {
  const id = tx
    .insert(pointAdjustments)
    .values({ ...a, ...links, madeBy: adminId, madeAt: toIsoUtc(now) })
    .returning({ id: pointAdjustments.id })
    .get().id
  writeAudit(tx, {
    actor: { kind: 'user', userId: adminId },
    action: 'points.adjusted',
    entityType: 'adjustment',
    entityId: id,
    after: { takerId: a.takerId, points: a.points, reason: a.reason, ...links },
    at: now,
  })
  return id
}

/** The admin adds or removes points by hand, with a reason (stored trimmed). */
export function adjustPointsIn(
  db: Db | Tx,
  adminId: number,
  input: { takerId: number; points: number; reason: string },
  from: FromDispute | null,
  now: Date,
): Result<{ adjustmentId: number }, FixError> {
  return inTx(db, (tx) => {
    const people = listPeople(tx)
    const total = currentTotal(tx, input.takerId)
    const made = adjustPoints(people, adminId, input.takerId, input.points, input.reason, total)
    if (!made.ok) return made
    if (made.value.points < 0 && weekWaiting(tx, now)) return fail('week_waiting')
    const open = from ? openDispute(tx, from) : null
    if (open && !open.ok) return open
    const adjustment = made.value
    const adjustmentId = insertAdjustment(
      tx,
      adminId,
      adjustment,
      { correctionId: null, disputeId: from?.disputeId ?? null },
      now,
    )
    if (from && open) {
      closeCorrected(
        tx,
        adminId,
        open.value,
        from.disputeId,
        { kind: 'adjustment', adjustment },
        { kind: 'adjustment', id: adjustmentId },
        adjustment.reason,
        now,
      )
    }
    return ok({ adjustmentId })
  })
}

/**
 * The admin corrects a final settlement to the level it should have had, with a reason. The
 * deduction is that level's points in the settled period (none → 0); the difference from the
 * settlement as it stands (its latest correction, else the original) goes to today's total.
 */
export function correctSettlementIn(
  db: Db | Tx,
  adminId: number,
  input: { settlementId: number; level: Level; reason: string },
  from: FromDispute | null,
  now: Date,
): Result<{ correctionId: number; adjustmentId: number | null }, FixError> {
  return inTx(db, (tx) => {
    const original = tx
      .select()
      .from(settlements)
      .where(eq(settlements.id, input.settlementId))
      .get()
    const period = original
      ? tx.select().from(periods).where(eq(periods.id, original.periodId)).get()
      : undefined
    if (!original || !period) return fail('not_found')
    const deducted =
      input.level === 'none' ? 0 : input.level === 'lower' ? period.lowerLevel : period.upperLevel
    const latest = latestCorrection(tx, original.id)
    const fixed = correctSettlement(
      listPeople(tx),
      adminId,
      original,
      latest ? toCorrection(original, latest) : null,
      { level: input.level, deducted },
      input.reason,
      currentTotal(tx, original.takerId),
    )
    if (!fixed.ok) return fixed
    const { correction, adjustment } = fixed.value
    if (adjustment && adjustment.points < 0 && weekWaiting(tx, now)) return fail('week_waiting')
    const open = from ? openDispute(tx, from) : null
    if (open && !open.ok) return open
    const disputeId = from?.disputeId ?? null
    const before = latest
      ? { level: latest.level, deducted: latest.deducted }
      : { level: original.level, deducted: original.deducted }
    const correctionId = tx
      .insert(settlementCorrections)
      .values({
        settlementId: original.id,
        level: correction.correctedLevel,
        deducted: correction.correctedDeducted,
        reason: correction.reason,
        disputeId,
        madeBy: adminId,
        madeAt: toIsoUtc(now),
      })
      .returning({ id: settlementCorrections.id })
      .get().id
    writeAudit(tx, {
      actor: { kind: 'user', userId: adminId },
      action: 'settlement.corrected',
      entityType: 'settlement',
      entityId: original.id,
      before,
      after: {
        correctionId,
        level: correction.correctedLevel,
        deducted: correction.correctedDeducted,
        reason: correction.reason,
      },
      at: now,
    })
    const adjustmentId = adjustment
      ? insertAdjustment(tx, adminId, adjustment, { correctionId, disputeId }, now)
      : null
    if (from && open) {
      closeCorrected(
        tx,
        adminId,
        open.value,
        from.disputeId,
        { kind: 'settlement_correction', correction },
        { kind: 'settlement_correction', id: correctionId },
        correction.reason,
        now,
      )
    }
    return ok({ correctionId, adjustmentId })
  })
}
