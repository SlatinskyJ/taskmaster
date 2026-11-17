import type { Person, PersonId } from './parties'
import { findPerson } from './parties'
import type { Result } from './result'
import { fail, ok } from './result'

// Settlement arithmetic, corrections and manual adjustments (spec §4, §5.9, §5.10).
//
// A taker's **running total** = confirmed points − points deducted by settlements ± adjustments.
// It is always reproducible from those three kinds of record (`runningTotal`) and never negative.
//
// Settling a period, per taker, with levels lower ≤ upper:
//   total ≥ upper          → level "upper", deduct upper, the rest carries over;
//   lower ≤ total < upper  → level "lower", deduct lower, the rest carries over;
//   total < lower          → level "none", deduct nothing, everything carries over, no debt.
//
// Settlements are final. Only the admin corrects one, with a reason: the original stays as it
// is, a correction record links to it, and [call] the point difference is posted as an
// adjustment to the taker's **current** running total. Later settlements are never rewritten.

export type SettlementError =
  | 'invalid_levels'
  | 'invalid_total'
  | 'invalid_points'
  | 'not_admin'
  | 'not_a_taker'
  | 'reason_required'
  | 'no_change'
  | 'would_go_negative'

/** The two thresholds of a period (spec §4). Both takers share them. */
export interface Levels {
  lower: number
  upper: number
}

export type Level = 'none' | 'lower' | 'upper'

const isPoints = (n: number) => Number.isInteger(n) && n >= 0

/** Whole numbers from 1, lower ≤ upper. */
export function isValidLevels(levels: Levels): boolean {
  return (
    Number.isInteger(levels.lower) &&
    Number.isInteger(levels.upper) &&
    levels.lower >= 1 &&
    levels.lower <= levels.upper
  )
}

/** The level a total reaches (spec §5.9). */
export function levelReached(total: number, levels: Levels): Level {
  if (total >= levels.upper) return 'upper'
  if (total >= levels.lower) return 'lower'
  return 'none'
}

/** One taker's settlement of one period (spec §5.9). Carry-over is stored, not recomputed. */
export interface SettlementRecord {
  periodId: number
  takerId: PersonId
  totalBefore: number
  level: Level
  deducted: number
  carryOver: number
}

/** Settles one taker's running total against the period's levels. */
export function settle(
  periodId: number,
  takerId: PersonId,
  totalBefore: number,
  levels: Levels,
): Result<SettlementRecord, SettlementError> {
  if (!isValidLevels(levels)) return fail('invalid_levels')
  if (!isPoints(totalBefore)) return fail('invalid_total')
  const level = levelReached(totalBefore, levels)
  const deducted = level === 'upper' ? levels.upper : level === 'lower' ? levels.lower : 0
  return ok({ periodId, takerId, totalBefore, level, deducted, carryOver: totalBefore - deducted })
}

// ── Running total ────────────────────────────────────────────────────────────────────────

/** The records a running total is built from (spec §5.10). */
export type LedgerEntry =
  /** A confirmed completion earned by the taker. */
  | { kind: 'completion'; takerId: PersonId; points: number }
  | { kind: 'settlement'; takerId: PersonId; deducted: number }
  /** Manual adjustment or the difference posted by a settlement correction; may be negative. */
  | { kind: 'adjustment'; takerId: PersonId; points: number }

/** Confirmed points − deducted ± adjustments, for one taker. */
export function runningTotal(entries: readonly LedgerEntry[], takerId: PersonId): number {
  let total = 0
  for (const e of entries) {
    if (e.takerId !== takerId) continue
    if (e.kind === 'settlement') total -= e.deducted
    else total += e.points
  }
  return total
}

// ── Admin: adjustments and corrections ───────────────────────────────────────────────────

export interface Adjustment {
  takerId: PersonId
  /** Positive adds points, negative removes them. Never 0. */
  points: number
  reason: string
}

function isActiveAdmin(people: readonly Person[], id: PersonId): boolean {
  const p = findPerson(people, id)
  return p !== undefined && p.active && p.role === 'admin'
}

function checkReason(reason: string): string | null {
  const trimmed = reason.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * The admin adds or removes points outside tasks, with a reason (spec §5.9). Refused if it
 * would take the taker's current running total below zero.
 */
export function adjustPoints(
  people: readonly Person[],
  adminId: PersonId,
  takerId: PersonId,
  points: number,
  reason: string,
  currentTotal: number,
): Result<Adjustment, SettlementError> {
  if (!isActiveAdmin(people, adminId)) return fail('not_admin')
  const taker = findPerson(people, takerId)
  if (taker?.role !== 'taker') return fail('not_a_taker')
  if (!Number.isInteger(points) || points === 0) return fail('invalid_points')
  const why = checkReason(reason)
  if (!why) return fail('reason_required')
  if (currentTotal + points < 0) return fail('would_go_negative')
  return ok({ takerId, points, reason: why })
}

/** A correction of a final settlement. The original record stays unchanged (spec §5.9). */
export interface SettlementCorrection {
  /** Links to the original settlement (period + taker identify it). */
  periodId: number
  takerId: PersonId
  originalLevel: Level
  originalDeducted: number
  /** The level that should have been reached, for the money paid outside the app. */
  correctedLevel: Level
  correctedDeducted: number
  reason: string
}

/**
 * The admin corrects a settlement: says what level and deduction it should have had. Writes a
 * correction record and [call] posts the difference (original deducted − corrected deducted) as
 * an adjustment to the taker's **current** running total; `null` when the points don't change
 * (only the level for the money changes). Refused if the adjustment would go below zero.
 */
export function correctSettlement(
  people: readonly Person[],
  adminId: PersonId,
  original: SettlementRecord,
  corrected: { level: Level; deducted: number },
  reason: string,
  currentTotal: number,
): Result<{ correction: SettlementCorrection; adjustment: Adjustment | null }, SettlementError> {
  if (!isActiveAdmin(people, adminId)) return fail('not_admin')
  if (!isPoints(corrected.deducted)) return fail('invalid_points')
  const why = checkReason(reason)
  if (!why) return fail('reason_required')
  if (corrected.level === original.level && corrected.deducted === original.deducted) {
    return fail('no_change')
  }
  const difference = original.deducted - corrected.deducted
  if (currentTotal + difference < 0) return fail('would_go_negative')
  const correction: SettlementCorrection = {
    periodId: original.periodId,
    takerId: original.takerId,
    originalLevel: original.level,
    originalDeducted: original.deducted,
    correctedLevel: corrected.level,
    correctedDeducted: corrected.deducted,
    reason: why,
  }
  const adjustment =
    difference === 0 ? null : { takerId: original.takerId, points: difference, reason: why }
  return ok({ correction, adjustment })
}
