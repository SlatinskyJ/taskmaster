import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import {
  canLengthen,
  canShorten,
  fromTime,
  sameDefaults,
  setLower,
  setUpper,
  stepLength,
  toTime,
  WEEKDAY_ORDER,
} from './defaultWeekForm'

const D = DEFAULT_PERIOD_DEFAULTS

describe('Výchozí týden form', () => {
  it('times', () => {
    expect(toTime(23, 59)).toBe('23:59')
    expect(toTime(8, 5)).toBe('08:05')
    expect(fromTime('20:00')).toEqual({ hour: 20, minute: 0 })
    expect(fromTime('00:00')).toEqual({ hour: 0, minute: 0 })
    expect(fromTime('')).toBeNull()
    expect(fromTime('24:00')).toBeNull()
    expect(fromTime('7:5')).toBeNull()
  })

  it('sameDefaults', () => {
    expect(sameDefaults(D, { ...D })).toBe(true)
    expect(sameDefaults(D, { ...D, lengthDays: 14 })).toBe(false)
    expect(sameDefaults(D, { ...D, cutoff: { ...D.cutoff, minute: 58 } })).toBe(false)
    expect(sameDefaults(D, { ...D, levels: { lower: 50, upper: 101 } })).toBe(false)
  })

  it('weekdays run Monday first and end on Sunday', () => {
    expect(WEEKDAY_ORDER).toEqual([1, 2, 3, 4, 5, 6, 0])
  })

  it('length steps a week, from 7 to 364 days', () => {
    expect(stepLength(D, 1).lengthDays).toBe(14)
    expect(stepLength(D, -1).lengthDays).toBe(7)
    expect(canShorten(D)).toBe(false)
    expect(canShorten({ ...D, lengthDays: 14 })).toBe(true)
    expect(canLengthen({ ...D, lengthDays: 357 })).toBe(true)
    expect(canLengthen({ ...D, lengthDays: 364 })).toBe(false)
    expect(stepLength({ ...D, lengthDays: 364 }, 1).lengthDays).toBe(364)
  })

  it('raising lower above upper raises upper; upper never drops below lower', () => {
    expect(setLower(D, 60).levels).toEqual({ lower: 60, upper: 100 })
    expect(setLower(D, 120).levels).toEqual({ lower: 120, upper: 120 })
    expect(setLower(D, 0).levels).toEqual({ lower: 1, upper: 100 })
    expect(setUpper(D, 40).levels).toEqual({ lower: 50, upper: 50 })
    expect(setUpper(D, 1000).levels).toEqual({ lower: 50, upper: 999 })
    expect(setLower(D, 1000).levels).toEqual({ lower: 999, upper: 999 })
  })
})
