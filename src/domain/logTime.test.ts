import { describe, expect, it } from 'vitest'
import { fromPragueWallTime } from './dates'
import { logChoices, logInstant } from './logTime'

// Zapsat's "Kdy?" (#38, Jakub 2026-11-22): a boy may say he did it this morning or yesterday.

const prague = (day: number, hour: number, minute = 0) =>
  fromPragueWallTime({ year: 2026, month: 11, day, hour, minute })
const TUE_10 = prague(24, 10)

describe('logInstant', () => {
  it('now is now; this morning is today 7:00; yesterday is yesterday 18:00 (Prague)', () => {
    expect(logInstant('now', TUE_10)).toEqual(TUE_10)
    expect(logInstant('this_morning', TUE_10)).toEqual(prague(24, 7))
    expect(logInstant('yesterday', TUE_10)).toEqual(prague(23, 18))
  })

  it('keeps the Prague clock across a DST switch', () => {
    const sunAfterSpring = fromPragueWallTime({
      year: 2026,
      month: 3,
      day: 30,
      hour: 10,
      minute: 0,
    })
    expect(logInstant('yesterday', sunAfterSpring).toISOString()).toBe('2026-03-29T16:00:00.000Z')
  })
})

describe('logChoices', () => {
  it('all three after 7:00 when the week started before yesterday 18:00', () => {
    expect(logChoices(TUE_10, prague(23, 0))).toEqual(['now', 'this_morning', 'yesterday'])
  })

  it('this morning only once 7:00 has passed (7:00 itself is not past)', () => {
    expect(logChoices(prague(24, 7), prague(20, 0))).toEqual(['now', 'yesterday'])
    expect(logChoices(prague(24, 7, 1), prague(20, 0))).toEqual([
      'now',
      'this_morning',
      'yesterday',
    ])
  })

  it('never before the running week started: a settled week stays settled', () => {
    expect(logChoices(TUE_10, prague(23, 18))).toEqual(['now', 'this_morning', 'yesterday'])
    expect(logChoices(TUE_10, prague(23, 18, 1))).toEqual(['now', 'this_morning'])
    expect(logChoices(TUE_10, prague(24, 7, 1))).toEqual(['now'])
  })

  it('with no week running yet, only now', () => {
    expect(logChoices(TUE_10, null)).toEqual(['now'])
  })
})
