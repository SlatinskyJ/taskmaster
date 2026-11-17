import { describe, expect, it } from 'vitest'
import { levelCrossed, pointsBarLayout } from './pointsBarScale'

describe('pointsBarLayout', () => {
  it('scales to 120 % of the upper level: 45 + 15 with levels 50 / 100', () => {
    // max = 120: 45 → 37.5 %, 60 → 50 %, 50 → 41.67 %, 100 → 83.33 %
    const l = pointsBarLayout({ confirmed: 45, pending: 15, lower: 50, upper: 100 })
    expect(l.confirmedPct).toBeCloseTo(37.5)
    expect(l.totalPct).toBeCloseTo(50)
    expect(l.lowerPct).toBeCloseTo(41.667, 2)
    expect(l.upperPct).toBeCloseTo(83.333, 2)
  })

  it('fills the bar and no more when points pass 120 % of upper', () => {
    const l = pointsBarLayout({ confirmed: 130, pending: 20, lower: 50, upper: 100 })
    expect(l.confirmedPct).toBe(100)
    expect(l.totalPct).toBe(100)
  })

  it('shows nothing for zero points', () => {
    const l = pointsBarLayout({ confirmed: 0, pending: 0, lower: 50, upper: 100 })
    expect(l.confirmedPct).toBe(0)
    expect(l.totalPct).toBe(0)
  })

  it('treats negative input as zero instead of drawing backwards', () => {
    const l = pointsBarLayout({ confirmed: -5, pending: -3, lower: 50, upper: 100 })
    expect(l.confirmedPct).toBe(0)
    expect(l.totalPct).toBe(0)
  })

  it('does not divide by zero on empty levels', () => {
    const l = pointsBarLayout({ confirmed: 1, pending: 0, lower: 0, upper: 0 })
    expect(Number.isFinite(l.confirmedPct)).toBe(true)
  })
})

describe('levelCrossed', () => {
  const levels = { lower: 50, upper: 100 }

  it.each([
    [45, 55, 'lower'],
    [45, 50, 'lower'],
    [90, 100, 'upper'],
    [45, 110, 'upper'],
    [50, 60, null],
    [100, 120, null],
    [55, 45, null],
    [45, 45, null],
  ] as const)('%i → %i gives %s', (before, after, expected) => {
    expect(levelCrossed(before, after, levels)).toBe(expected)
  })
})
