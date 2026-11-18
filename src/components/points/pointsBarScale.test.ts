import { describe, expect, it } from 'vitest'
import { createLevelWatcher, levelCrossed, pointsBarLayout } from './pointsBarScale'

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

describe('pointsBarLayout tick labels', () => {
  it('centres both labels when the levels are far apart (50 / 100)', () => {
    const l = pointsBarLayout({ confirmed: 0, pending: 0, lower: 50, upper: 100 })
    expect([l.lowerLabel, l.upperLabel]).toEqual(['center', 'center'])
  })

  it('pushes the labels apart when the levels are close (85 / 100)', () => {
    const l = pointsBarLayout({ confirmed: 0, pending: 0, lower: 85, upper: 100 })
    expect([l.lowerLabel, l.upperLabel]).toEqual(['end', 'start'])
  })

  it('keeps a very low lower level label inside the bar (5 / 100)', () => {
    const l = pointsBarLayout({ confirmed: 0, pending: 0, lower: 5, upper: 100 })
    expect(l.lowerLabel).toBe('start')
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

describe('createLevelWatcher', () => {
  const levels = { lower: 50, upper: 100 }

  it('never celebrates the value it starts with, however high', () => {
    const w = createLevelWatcher(120, 'ondra/w46')
    expect(w.next(120, levels, 'ondra/w46', true)).toBeNull()
  })

  it('celebrates one crossing once, not again on an unchanged re-render', () => {
    const w = createLevelWatcher(45, 'ondra/w46')
    expect(w.next(55, levels, 'ondra/w46', true)).toBe('lower')
    expect(w.next(55, levels, 'ondra/w46', true)).toBeNull()
    expect(w.next(100, levels, 'ondra/w46', true)).toBe('upper')
  })

  it('does not celebrate when the bar switches to another taker or period', () => {
    const w = createLevelWatcher(40, 'ondra/w45')
    expect(w.next(60, levels, 'ondra/w46', true)).toBeNull()
    expect(w.next(60, levels, 'tomas/w46', true)).toBeNull()
    // …but a real rise after the switch still counts.
    expect(w.next(100, levels, 'tomas/w46', true)).toBe('upper')
  })

  it('stays quiet without celebrate, and does not replay that crossing later', () => {
    const w = createLevelWatcher(45, 'ondra/w46')
    expect(w.next(55, levels, 'ondra/w46', false)).toBeNull()
    expect(w.next(55, levels, 'ondra/w46', true)).toBeNull()
    // …but a real rise after it comes back on still counts.
    expect(w.next(100, levels, 'ondra/w46', true)).toBe('upper')
  })
})
