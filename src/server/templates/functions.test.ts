import { describe, expect, it } from 'vitest'
import { parseNewTemplate } from './parse'

const VALID = {
  title: 'Vynést koše',
  score: 4,
  approvalRequired: true,
  schedule: { days: [2], time: { hour: 18, minute: 30 } },
  deadline: { dayOffset: 1, due: { hour: 7, minute: 45 }, graceMinutes: 90 },
}

describe('parseNewTemplate (input types only; ranges are the domain)', () => {
  it('accepts a full body', () => {
    expect(parseNewTemplate(VALID)).toEqual(VALID)
  })

  it('accepts no schedule, no deadline and a schedule without a time', () => {
    expect(parseNewTemplate({ ...VALID, schedule: null, deadline: null })).toEqual({
      ...VALID,
      schedule: null,
      deadline: null,
    })
    expect(parseNewTemplate({ ...VALID, schedule: { days: [0], time: null } }).schedule).toEqual({
      days: [0],
      time: null,
    })
  })

  it('passes out-of-range numbers on to the domain', () => {
    expect(parseNewTemplate({ ...VALID, schedule: { days: [9], time: null } }).schedule).toEqual({
      days: [9],
      time: null,
    })
  })

  it.each([
    ['a string score', { score: '4' }],
    ['days as a string', { schedule: { days: '2', time: null } }],
    ['8 days', { schedule: { days: [0, 1, 2, 3, 4, 5, 6, 0], time: null } }],
    ['a missing deadline key', { deadline: undefined }],
    ['a nested string hour', { schedule: { days: [2], time: { hour: '18', minute: 0 } } }],
    ['a deadline without grace', { deadline: { dayOffset: 1, due: { hour: 7, minute: 0 } } }],
    ['a non-boolean flag', { approvalRequired: 'yes' }],
    ['a fractional day', { schedule: { days: [1.5], time: null } }],
  ])('throws on %s', (_, change) => {
    expect(() => parseNewTemplate({ ...VALID, ...change })).toThrow('Invalid input')
  })

  it('throws on a non-object body', () => {
    expect(() => parseNewTemplate(null)).toThrow('Invalid input')
    expect(() => parseNewTemplate('x')).toThrow('Invalid input')
  })
})
