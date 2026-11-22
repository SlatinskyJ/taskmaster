import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import { defaultsView, parseDefaults, saveResult } from './functions'

const valid = {
  lengthDays: 14,
  cutoff: { weekday: 6, hour: 20, minute: 0 },
  levels: { lower: 60, upper: 120 },
}

describe('parseDefaults', () => {
  it('passes valid input through', () => {
    expect(parseDefaults(valid)).toStrictEqual(valid)
  })

  it('accepts the boundaries: upper 999, 364 days', () => {
    const edge = { ...valid, lengthDays: 364, levels: { lower: 1, upper: 999 } }
    expect(parseDefaults(edge)).toStrictEqual(edge)
  })

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['missing lengthDays', { cutoff: valid.cutoff, levels: valid.levels }],
    ['missing levels', { lengthDays: 14, cutoff: valid.cutoff }],
    ['missing minute', { ...valid, cutoff: { weekday: 6, hour: 20 } }],
    ['a string number', { ...valid, lengthDays: '14' }],
    ['a fraction', { ...valid, levels: { lower: 1.5, upper: 120 } }],
    ['upper 1000', { ...valid, levels: { lower: 60, upper: 1000 } }],
    ['371 days', { ...valid, lengthDays: 371 }],
    ['cutoff not an object', { ...valid, cutoff: 'Sunday' }],
    ['levels null', { ...valid, levels: null }],
    ['an extra top-level key', { ...valid, updatedBy: 3 }],
    ['an extra key in cutoff', { ...valid, cutoff: { ...valid.cutoff, second: 0 } }],
    ['an extra key in levels', { ...valid, levels: { ...valid.levels, middle: 80 } }],
  ])('throws on %s', (_name, input) => {
    expect(() => parseDefaults(input)).toThrow('Invalid input')
  })
})

describe('what the functions return', () => {
  it('getPeriodDefaultsFn returns exactly the defaults fields', () => {
    const stored = { ...DEFAULT_PERIOD_DEFAULTS, id: 1, updatedBy: 7 }
    expect(defaultsView(stored)).toStrictEqual({
      lengthDays: 7,
      cutoff: { weekday: 0, hour: 23, minute: 59 },
      levels: { lower: 50, upper: 100 },
    })
  })

  it('savePeriodDefaultsFn returns { ok: true } or { ok: false, error }', () => {
    expect(saveResult({ ok: true, value: DEFAULT_PERIOD_DEFAULTS })).toStrictEqual({ ok: true })
    expect(saveResult({ ok: false, error: 'not_admin' })).toStrictEqual({
      ok: false,
      error: 'not_admin',
    })
  })
})
