import { levelLabel } from '~/components/period/periodView'
import type { Level } from '~/domain'
import { ADJUST_POINTS_MAX } from '~/lib/disputeLimits'
import { cs } from '~/lib/strings'
import type { FixTaker, FixWeek } from '~/server/corrections/functions'
import type { AdminDisputeEntry } from '~/server/disputes/functions'
import type { FixRequest } from './fixCalls'

// The fix sheet's rules (#48, UI doc AFix): what it starts with, what it sends, what it
// previews and how its button reads. Pure; FixDrawer holds the draft.

/** How the sheet opens: directly from Opravy bodů, or from a Sporné row (`dispute`). */
export type FixStart =
  | { mode: 'points'; takerId: number | null; dispute: AdminDisputeEntry | null }
  | {
      mode: 'week'
      takerId: number | null
      settlementId: number | null
      dispute: AdminDisputeEntry | null
    }

export interface FixDraft {
  mode: 'points' | 'week'
  takerId: number | null
  /** Přidat (1) or Ubrat (−1). */
  sign: 1 | -1
  /** The number as typed. */
  amount: string
  settlementId: number | null
  level: Level | null
  reason: string
}

export function initialDraft(start: FixStart, reason: string): FixDraft {
  return {
    mode: start.mode,
    takerId: start.takerId,
    sign: 1,
    amount: '',
    settlementId: start.mode === 'week' ? start.settlementId : null,
    level: null,
    reason,
  }
}

/** A whole number 1–ADJUST_POINTS_MAX as typed, else null. */
export function pointsAmount(amount: string): number | null {
  if (!/^\d+$/.test(amount)) return null
  const n = Number(amount)
  return n >= 1 && n <= ADJUST_POINTS_MAX ? n : null
}

const takerOf = (fixable: readonly FixTaker[], id: number | null) =>
  id === null ? undefined : fixable.find((t) => t.id === id)

/** The week and whose it is, found by its settlement in every boy's list. */
export function weekOf(
  fixable: readonly FixTaker[],
  settlementId: number | null,
): { taker: FixTaker; week: FixWeek } | undefined {
  for (const taker of fixable) {
    const week = taker.weeks.find((w) => w.settlementId === settlementId)
    if (week) return { taker, week }
  }
  return undefined
}

const deductionOf = (week: FixWeek, level: Level) =>
  level === 'none' ? 0 : level === 'lower' ? week.levels.lower : week.levels.upper

/** What the request sends, or null while something is missing (or the level is unchanged). */
export function fixRequest(
  d: FixDraft,
  start: FixStart,
  fixable: readonly FixTaker[],
): FixRequest | null {
  if (d.reason.trim() === '') return null
  const from = start.dispute ? { disputeId: start.dispute.id, seen: start.dispute.value } : null
  if (d.mode === 'points') {
    const n = pointsAmount(d.amount)
    if (d.takerId === null || n === null) return null
    return {
      mode: 'points',
      input: { takerId: d.takerId, points: d.sign * n, reason: d.reason, from },
    }
  }
  if (d.settlementId === null || d.level === null) return null
  if (weekOf(fixable, d.settlementId)?.week.level === d.level) return null
  return {
    mode: 'week',
    input: { settlementId: d.settlementId, level: d.level, reason: d.reason, from },
  }
}

/** Points mode: „Starší: 62 → 57 b.“, or null until a boy and a number. */
export function pointsPreview(d: FixDraft, fixable: readonly FixTaker[]): string | null {
  const t = takerOf(fixable, d.takerId)
  const n = pointsAmount(d.amount)
  if (!t || n === null) return null
  return cs.admin.fix.preview(t.name, t.total, t.total + d.sign * n)
}

/** Points mode: Ubrat would take him below zero (the server refuses it). */
export function belowZero(d: FixDraft, fixable: readonly FixTaker[]): boolean {
  const t = takerOf(fixable, d.takerId)
  const n = pointsAmount(d.amount)
  return t !== undefined && n !== null && t.total + d.sign * n < 0
}

/** Week mode: the change on today's total (current deduction − new), or null. */
export function weekDifference(d: FixDraft, fixable: readonly FixTaker[]): number | null {
  const found = weekOf(fixable, d.settlementId)
  if (!found || d.level === null) return null
  return found.week.deducted - deductionOf(found.week, d.level)
}

/** The send button's text, naming the action and the boy; null until it can say so. */
export function sendLabel(d: FixDraft, fixable: readonly FixTaker[]): string | null {
  const f = cs.admin.fix
  if (d.mode === 'points') {
    const t = takerOf(fixable, d.takerId)
    const n = pointsAmount(d.amount)
    if (!t || n === null) return null
    return d.sign > 0 ? f.sendAdd(n, t.name) : f.sendRemove(n, t.name)
  }
  const found = weekOf(fixable, d.settlementId)
  if (!found || d.level === null) return null
  return f.sendCorrect(levelLabel(d.level), found.taker.name)
}
