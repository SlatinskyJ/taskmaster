import { describe, expect, it } from 'vitest'
import type { Person } from './parties'
import type { Result } from './result'
import type { LedgerEntry, Levels, SettlementError, SettlementRecord } from './settlement'
import {
  adjustPoints,
  correctSettlement,
  isValidLevels,
  levelReached,
  runningTotal,
  settle,
} from './settlement'

const DAD = 1
const OLDER = 2
const YOUNGER = 3
const JAKUB = 4
const family: Person[] = [
  { id: DAD, role: 'giver', active: true },
  { id: OLDER, role: 'taker', active: true },
  { id: YOUNGER, role: 'taker', active: true },
  { id: JAKUB, role: 'admin', active: true },
]
const LEVELS: Levels = { lower: 50, upper: 100 }
const WEEK = 7

function value<T>(result: Result<T, SettlementError>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return result.value
}
function error<T>(result: Result<T, SettlementError>): SettlementError {
  if (result.ok) throw new Error('expected an error')
  return result.error
}

describe('settlement arithmetic (spec §5.9)', () => {
  it('spec example: 130 → upper, 100 deducted, 30 carries', () => {
    expect(value(settle(family, DAD, WEEK, OLDER, 130, LEVELS))).toEqual({
      periodId: WEEK,
      takerId: OLDER,
      totalBefore: 130,
      level: 'upper',
      deducted: 100,
      carryOver: 30,
    })
  })

  it('spec example: 30 → none, nothing deducted, 30 carries, no debt', () => {
    expect(value(settle(family, DAD, WEEK, OLDER, 30, LEVELS))).toMatchObject({
      level: 'none',
      deducted: 0,
      carryOver: 30,
    })
  })

  it('between the levels → lower, lower deducted', () => {
    expect(value(settle(family, DAD, WEEK, OLDER, 75, LEVELS))).toMatchObject({
      level: 'lower',
      deducted: 50,
      carryOver: 25,
    })
  })

  it('boundaries: exactly lower and exactly upper reach that level', () => {
    expect(levelReached(49, LEVELS)).toBe('none')
    expect(levelReached(50, LEVELS)).toBe('lower')
    expect(levelReached(99, LEVELS)).toBe('lower')
    expect(levelReached(100, LEVELS)).toBe('upper')
    expect(value(settle(family, DAD, WEEK, OLDER, 100, LEVELS)).carryOver).toBe(0)
    expect(value(settle(family, DAD, WEEK, OLDER, 50, LEVELS)).carryOver).toBe(0)
  })

  it('zero points: none, nothing happens', () => {
    expect(value(settle(family, DAD, WEEK, OLDER, 0, LEVELS))).toMatchObject({
      level: 'none',
      carryOver: 0,
    })
  })

  it('equal levels work: reaching it is upper', () => {
    expect(value(settle(family, DAD, WEEK, OLDER, 60, { lower: 60, upper: 60 }))).toMatchObject({
      level: 'upper',
      deducted: 60,
    })
  })

  it('refuses bad levels and bad totals', () => {
    for (const levels of [
      { lower: 0, upper: 100 },
      { lower: 100, upper: 50 },
      { lower: 50.5, upper: 100 },
      { lower: 50, upper: Number.NaN },
    ]) {
      expect(isValidLevels(levels)).toBe(false)
      expect(error(settle(family, DAD, WEEK, OLDER, 80, levels))).toBe('invalid_levels')
    }
    for (const total of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(error(settle(family, DAD, WEEK, OLDER, total, LEVELS))).toBe('invalid_total')
    }
  })

  it('property: for every total and level pair, carry = total − deducted, never negative', () => {
    for (let lower = 1; lower <= 30; lower += 7) {
      for (let upper = lower; upper <= 60; upper += 11) {
        for (let total = 0; total <= 150; total++) {
          const r = value(settle(family, DAD, WEEK, OLDER, total, { lower, upper }))
          expect(r.carryOver).toBe(total - r.deducted)
          expect(r.carryOver).toBeGreaterThanOrEqual(0)
          expect([0, lower, upper]).toContain(r.deducted)
          // The highest level reached is taken, and only if reached.
          if (total >= upper) expect(r.deducted).toBe(upper)
          else if (total >= lower) expect(r.deducted).toBe(lower)
          else expect(r.deducted).toBe(0)
        }
      }
    }
  })
})

describe('running total is reproducible (spec §4, §5.10)', () => {
  const ledger: LedgerEntry[] = [
    { kind: 'completion', takerId: OLDER, points: 80 },
    { kind: 'completion', takerId: YOUNGER, points: 40 },
    { kind: 'completion', takerId: OLDER, points: 50 },
    { kind: 'settlement', takerId: OLDER, deducted: 100 },
    { kind: 'adjustment', takerId: OLDER, points: -5 },
    { kind: 'completion', takerId: OLDER, points: 10 },
  ]

  it('confirmed − deducted ± adjustments, per taker', () => {
    expect(runningTotal(ledger, OLDER)).toBe(35)
    expect(runningTotal(ledger, YOUNGER)).toBe(40)
    expect(runningTotal([], OLDER)).toBe(0)
  })

  it('property: after settling, the ledger total equals the stored carry-over', () => {
    for (let total = 0; total <= 250; total += 3) {
      const entries: LedgerEntry[] = [{ kind: 'completion', takerId: OLDER, points: total }]
      const r = value(settle(family, DAD, WEEK, OLDER, runningTotal(entries, OLDER), LEVELS))
      entries.push({ kind: 'settlement', takerId: OLDER, deducted: r.deducted })
      expect(runningTotal(entries, OLDER)).toBe(r.carryOver)
    }
  })

  it('carry-over feeds the next week', () => {
    const w1 = value(settle(family, DAD, 1, OLDER, 130, LEVELS))
    const w2 = value(settle(family, DAD, 2, OLDER, w1.carryOver + 40, LEVELS))
    expect(w2).toMatchObject({ totalBefore: 70, level: 'lower', carryOver: 20 })
  })
})

describe('manual adjustments (spec §5.9): admin only, reason required', () => {
  it('the admin adds or removes points with a reason', () => {
    expect(value(adjustPoints(family, JAKUB, OLDER, 10, ' bonus za Vánoce ', 0))).toEqual({
      takerId: OLDER,
      points: 10,
      reason: 'bonus za Vánoce',
    })
    expect(value(adjustPoints(family, JAKUB, OLDER, -5, 'omyl', 20)).points).toBe(-5)
  })

  it('nobody else, and not an inactive admin', () => {
    for (const who of [DAD, OLDER]) {
      expect(error(adjustPoints(family, who, OLDER, 10, 'x', 0))).toBe('not_admin')
    }
    const exAdmin = family.map((p) => (p.id === JAKUB ? { ...p, active: false } : p))
    expect(error(adjustPoints(exAdmin, JAKUB, OLDER, 10, 'x', 0))).toBe('not_admin')
  })

  it('only for a taker', () => {
    expect(error(adjustPoints(family, JAKUB, DAD, 10, 'x', 0))).toBe('not_a_taker')
    expect(error(adjustPoints(family, JAKUB, 99, 10, 'x', 0))).toBe('not_a_taker')
  })

  it('needs a reason and a non-zero whole number', () => {
    expect(error(adjustPoints(family, JAKUB, OLDER, 10, '   ', 0))).toBe('reason_required')
    for (const points of [0, 1.5, Number.NaN]) {
      expect(error(adjustPoints(family, JAKUB, OLDER, points, 'x', 0))).toBe('invalid_points')
    }
  })

  it('the running total never goes negative', () => {
    expect(value(adjustPoints(family, JAKUB, OLDER, -20, 'x', 20)).points).toBe(-20)
    expect(error(adjustPoints(family, JAKUB, OLDER, -21, 'x', 20))).toBe('would_go_negative')
  })
})

describe('settlement correction (spec §5.9) [call] difference goes to the current total', () => {
  // Week 7: older had 130 but was settled as if he had 75 (lower, 50 deducted).
  const wrong: SettlementRecord = value(settle(family, DAD, WEEK, OLDER, 75, LEVELS))

  it('keeps the original, writes a linked correction, posts the difference', () => {
    const before = structuredClone(wrong)
    const r = value(
      correctSettlement(
        family,
        JAKUB,
        wrong,
        null,
        { level: 'upper', deducted: 100 },
        'špatný součet',
        60,
      ),
    )
    expect(r.correction).toEqual({
      periodId: WEEK,
      takerId: OLDER,
      originalLevel: 'lower',
      originalDeducted: 50,
      correctedLevel: 'upper',
      correctedDeducted: 100,
      reason: 'špatný součet',
    })
    expect(r.adjustment).toEqual({ takerId: OLDER, points: -50, reason: 'špatný součet' })
    expect(wrong).toEqual(before)
  })

  it('too much deducted: the points come back as a positive adjustment', () => {
    const tooMuch = value(settle(family, DAD, WEEK, OLDER, 130, LEVELS))
    const r = value(
      correctSettlement(family, JAKUB, tooMuch, null, { level: 'lower', deducted: 50 }, 'x', 0),
    )
    expect(r.adjustment?.points).toBe(50)
  })

  it('only the level changes (money outside the app): no point adjustment', () => {
    const r = value(
      correctSettlement(family, JAKUB, wrong, null, { level: 'upper', deducted: 50 }, 'x', 10),
    )
    expect(r.adjustment).toBeNull()
    expect(r.correction.correctedLevel).toBe('upper')
  })

  it('the adjustment lands on the current total; later settlements stay as they were', () => {
    const later = value(settle(family, DAD, WEEK + 1, OLDER, 60, LEVELS))
    const r = value(
      correctSettlement(family, JAKUB, wrong, null, { level: 'upper', deducted: 100 }, 'x', 70),
    )
    const ledger: LedgerEntry[] = [
      { kind: 'completion', takerId: OLDER, points: 75 },
      { kind: 'settlement', takerId: OLDER, deducted: wrong.deducted },
      { kind: 'completion', takerId: OLDER, points: 35 },
      { kind: 'settlement', takerId: OLDER, deducted: later.deducted },
      { kind: 'completion', takerId: OLDER, points: 60 },
    ]
    expect(runningTotal(ledger, OLDER)).toBe(70)
    if (r.adjustment) ledger.push({ kind: 'adjustment', ...r.adjustment })
    expect(runningTotal(ledger, OLDER)).toBe(20)
    expect(later).toMatchObject({ deducted: 50, carryOver: 10 })
  })

  it('admin only, reason required, a real change, whole points', () => {
    const fix = { level: 'upper' as const, deducted: 100 }
    expect(error(correctSettlement(family, DAD, wrong, null, fix, 'x', 60))).toBe('not_admin')
    expect(error(correctSettlement(family, JAKUB, wrong, null, fix, '', 60))).toBe(
      'reason_required',
    )
    expect(
      error(
        correctSettlement(family, JAKUB, wrong, null, { level: 'lower', deducted: 50 }, 'x', 60),
      ),
    ).toBe('no_change')
    expect(
      error(
        correctSettlement(family, JAKUB, wrong, null, { level: 'upper', deducted: -1 }, 'x', 60),
      ),
    ).toBe('invalid_points')
  })

  it('refused if the difference would take the current total below zero', () => {
    const fix = { level: 'upper' as const, deducted: 100 }
    expect(error(correctSettlement(family, JAKUB, wrong, null, fix, 'x', 49))).toBe(
      'would_go_negative',
    )
    expect(
      value(correctSettlement(family, JAKUB, wrong, null, fix, 'x', 50)).adjustment?.points,
    ).toBe(-50)
  })

  it('nobody but an active admin corrects', () => {
    const fix = { level: 'upper' as const, deducted: 100 }
    for (const who of [DAD, OLDER, YOUNGER]) {
      expect(error(correctSettlement(family, who, wrong, null, fix, 'x', 60))).toBe('not_admin')
    }
    const exAdmin = family.map((p) => (p.id === JAKUB ? { ...p, active: false } : p))
    expect(error(correctSettlement(exAdmin, JAKUB, wrong, null, fix, 'x', 60))).toBe('not_admin')
  })

  it('refuses bad points, a blank reason, and a level that does not match the deduction', () => {
    for (const deducted of [1.5, Number.NaN, -1]) {
      const bad = { level: 'upper' as const, deducted }
      expect(error(correctSettlement(family, JAKUB, wrong, null, bad, 'x', 60))).toBe(
        'invalid_points',
      )
    }
    const fix = { level: 'upper' as const, deducted: 100 }
    expect(error(correctSettlement(family, JAKUB, wrong, null, fix, '   ', 60))).toBe(
      'reason_required',
    )
    for (const bad of [
      { level: 'none' as const, deducted: 100 },
      { level: 'upper' as const, deducted: 0 },
    ]) {
      expect(error(correctSettlement(family, JAKUB, wrong, null, bad, 'x', 60))).toBe(
        'invalid_points',
      )
    }
    const none = value(
      correctSettlement(family, JAKUB, wrong, null, { level: 'none', deducted: 0 }, 'x', 0),
    )
    expect(none.adjustment?.points).toBe(50)
  })

  it('correcting twice measures from the latest correction, never double-counts', () => {
    const settled = value(settle(family, DAD, WEEK, OLDER, 130, LEVELS)) // upper, −100
    const toLower = { level: 'lower' as const, deducted: 50 }
    const first = value(correctSettlement(family, JAKUB, settled, null, toLower, 'x', 0))
    expect(first.adjustment?.points).toBe(50)
    // Same fix again: nothing to change.
    expect(
      error(correctSettlement(family, JAKUB, settled, first.correction, toLower, 'x', 50)),
    ).toBe('no_change')
    // Back to the original: −50 is owed again.
    const back = value(
      correctSettlement(
        family,
        JAKUB,
        settled,
        first.correction,
        { level: 'upper', deducted: 100 },
        'x',
        50,
      ),
    )
    expect(back.adjustment?.points).toBe(-50)
    expect(back.correction).toMatchObject({ originalDeducted: 100, correctedDeducted: 100 })
    expect(settled.deducted).toBe(100)
  })
})

describe('who settles (spec §5.9)', () => {
  it('an active giver settles a taker; nobody else', () => {
    for (const who of [OLDER, JAKUB]) {
      expect(error(settle(family, who, WEEK, OLDER, 80, LEVELS))).toBe('not_a_giver')
    }
    const exDad = family.map((p) => (p.id === DAD ? { ...p, active: false } : p))
    expect(error(settle(exDad, DAD, WEEK, OLDER, 80, LEVELS))).toBe('not_a_giver')
    expect(error(settle(family, DAD, WEEK, JAKUB, 80, LEVELS))).toBe('not_a_taker')
  })
})
