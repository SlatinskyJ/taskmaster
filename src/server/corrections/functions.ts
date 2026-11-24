import { createServerFn } from '@tanstack/react-start'
import type { Level } from '~/domain'
import { ADJUST_POINTS_MAX, FIX_REASON_MAX } from '~/lib/disputeLimits'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import type { Db } from '~/server/db'
import { SETTLEMENT_LEVELS } from '~/server/db/schema'
import { kindOf, parseSeenValue, positiveId } from '~/server/disputes/functions'
import { getFlags } from '~/server/features'
import { record } from '~/server/periods/validators'
import { adjustPointsIn, correctSettlementIn } from './corrections'
import type { FixError, FromDispute } from './corrections'

export type { FixError } from './corrections'

// Server functions for settlement corrections and point adjustments (spec §5.9, #48): admin
// only (the domain checks the admin again), behind the launch switch `disputes`. With it off
// they answer `feature_off` and write nothing. The answer carries no ids and no rows.

export interface AdjustPointsInput {
  takerId: number
  points: number
  reason: string
  from: FromDispute | null
}

export interface CorrectSettlementInput {
  settlementId: number
  level: Level
  reason: string
  from: FromDispute | null
}

export type FixResult = { ok: true } | { ok: false; error: FixError | 'feature_off' }

function reasonOf(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length > FIX_REASON_MAX) {
    throw new Error('Invalid input')
  }
  return value
}

function fromOf(value: unknown): FromDispute | null {
  if (value === null) return null
  const d = record(value, ['disputeId', 'seen'])
  return { disputeId: positiveId(d.disputeId), seen: parseSeenValue(d.seen) }
}

/** Exactly `{ takerId, points, reason, from }`; points a whole number, not 0, ±ADJUST_POINTS_MAX. */
export function parseAdjustPoints(data: unknown): AdjustPointsInput {
  const d = record(data, ['takerId', 'points', 'reason', 'from'])
  const points = d.points
  if (
    typeof points !== 'number' ||
    !Number.isInteger(points) ||
    points === 0 ||
    Math.abs(points) > ADJUST_POINTS_MAX
  ) {
    throw new Error('Invalid input')
  }
  return {
    takerId: positiveId(d.takerId),
    points,
    reason: reasonOf(d.reason),
    from: fromOf(d.from),
  }
}

/** Exactly `{ settlementId, level, reason, from }`. */
export function parseCorrectSettlement(data: unknown): CorrectSettlementInput {
  const d = record(data, ['settlementId', 'level', 'reason', 'from'])
  return {
    settlementId: positiveId(d.settlementId),
    level: kindOf(d.level, SETTLEMENT_LEVELS),
    reason: reasonOf(d.reason),
    from: fromOf(d.from),
  }
}

const OFF = { ok: false, error: 'feature_off' } as const

export function adjustPointsHandler(
  db: Db,
  adminId: number,
  input: AdjustPointsInput,
  now: Date,
): FixResult {
  if (!getFlags(db).disputes) return OFF
  const { from, ...a } = input
  const r = adjustPointsIn(db, adminId, a, from, now)
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

export function correctSettlementHandler(
  db: Db,
  adminId: number,
  input: CorrectSettlementInput,
  now: Date,
): FixResult {
  if (!getFlags(db).disputes) return OFF
  const { from, ...c } = input
  const r = correctSettlementIn(db, adminId, c, from, now)
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

export const adjustPointsFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin')])
  .validator(parseAdjustPoints)
  .handler(({ data, context }) => adjustPointsHandler(getDb(), context.user.id, data, new Date()))

export const correctSettlementFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin')])
  .validator(parseCorrectSettlement)
  .handler(({ data, context }) =>
    correctSettlementHandler(getDb(), context.user.id, data, new Date()),
  )
