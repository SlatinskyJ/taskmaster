import { describe, expect, it } from 'vitest'
import {
  addPragueDays,
  fromPragueWallTime,
  nextPragueWeekdayAt,
  parseIsoUtc,
  startOfPragueDay,
  toIsoUtc,
  toPragueWallTime,
} from './dates'

// 2026 DST in Prague: spring forward Sun 29 March 02:00 → 03:00 (CET +1 → CEST +2),
// fall back Sun 25 October 03:00 → 02:00 (CEST → CET).
const utc = (iso: string) => new Date(iso)
const wall = (year: number, month: number, day: number, hour = 0, minute = 0) => ({
  year,
  month,
  day,
  hour,
  minute,
})

describe('fromPragueWallTime / toPragueWallTime', () => {
  it.each([
    ['winter (CET, +1)', wall(2026, 11, 15, 18), '2026-11-15T17:00:00.000Z'],
    ['summer (CEST, +2)', wall(2026, 7, 5, 18), '2026-07-05T16:00:00.000Z'],
    ['New Year midnight', wall(2027, 1, 1, 0), '2026-12-31T23:00:00.000Z'],
    ['just before spring forward', wall(2026, 3, 29, 1, 59), '2026-03-29T00:59:00.000Z'],
    ['just after spring forward', wall(2026, 3, 29, 3, 0), '2026-03-29T01:00:00.000Z'],
  ])('%s', (_, w, iso) => {
    expect(fromPragueWallTime(w).toISOString()).toBe(iso)
    expect(toPragueWallTime(utc(iso))).toMatchObject(w)
  })

  it('moves a wall time inside the spring-forward gap forward by the gap', () => {
    // 02:30 does not exist on 29 March; it becomes 03:30 CEST.
    expect(fromPragueWallTime(wall(2026, 3, 29, 2, 30)).toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    )
  })

  it('resolves a repeated fall-back wall time to the second (winter) occurrence', () => {
    expect(fromPragueWallTime(wall(2026, 10, 25, 2, 30)).toISOString()).toBe(
      '2026-10-25T01:30:00.000Z',
    )
    // Both real instants read back as 02:30 on a Prague clock.
    expect(toPragueWallTime(utc('2026-10-25T00:30:00.000Z'))).toMatchObject({ hour: 2 })
    expect(toPragueWallTime(utc('2026-10-25T01:30:00.000Z'))).toMatchObject({ hour: 2 })
  })

  it('reports the Prague weekday, not the UTC one', () => {
    // Sunday 23:30 UTC is already Monday 00:30 in Prague.
    expect(toPragueWallTime(utc('2026-11-15T23:30:00.000Z'))).toMatchObject({
      day: 16,
      weekday: 1,
    })
  })
})

describe('startOfPragueDay', () => {
  it('is Prague midnight, not UTC midnight', () => {
    expect(startOfPragueDay(utc('2026-11-15T23:30:00.000Z')).toISOString()).toBe(
      '2026-11-15T23:00:00.000Z',
    )
  })

  it('handles the short and long DST days', () => {
    expect(startOfPragueDay(utc('2026-03-29T20:00:00.000Z')).toISOString()).toBe(
      '2026-03-28T23:00:00.000Z',
    )
    expect(startOfPragueDay(utc('2026-10-25T20:00:00.000Z')).toISOString()).toBe(
      '2026-10-24T22:00:00.000Z',
    )
  })
})

describe('addPragueDays', () => {
  it('keeps the wall time across spring forward (a 7-day week is 167 hours)', () => {
    const cutoff = fromPragueWallTime(wall(2026, 3, 22, 18)) // Sun 22 March, CET
    const next = addPragueDays(cutoff, 7)
    expect(next.toISOString()).toBe('2026-03-29T16:00:00.000Z') // Sun 29 March 18:00 CEST
    expect((next.getTime() - cutoff.getTime()) / 3_600_000).toBe(167)
  })

  it('keeps the wall time across fall back (a 7-day week is 169 hours)', () => {
    const cutoff = fromPragueWallTime(wall(2026, 10, 18, 18))
    const next = addPragueDays(cutoff, 7)
    expect(toPragueWallTime(next)).toMatchObject(wall(2026, 10, 25, 18))
    expect((next.getTime() - cutoff.getTime()) / 3_600_000).toBe(169)
  })

  it('rolls over month and year ends', () => {
    expect(
      toPragueWallTime(addPragueDays(fromPragueWallTime(wall(2026, 12, 27, 18)), 7)),
    ).toMatchObject(wall(2027, 1, 3, 18))
  })

  it('goes backwards with a negative count', () => {
    expect(
      toPragueWallTime(addPragueDays(fromPragueWallTime(wall(2026, 3, 30, 9)), -2)),
    ).toMatchObject(wall(2026, 3, 28, 9))
  })
})

describe('nextPragueWeekdayAt', () => {
  const sunday18 = (from: string) => nextPragueWeekdayAt(utc(from), 0, 18).toISOString()

  it('finds the coming Sunday 18:00', () => {
    // Wed 11 Nov 2026 → Sun 15 Nov 18:00 CET
    expect(sunday18('2026-11-11T10:00:00.000Z')).toBe('2026-11-15T17:00:00.000Z')
  })

  it('is strictly after: exactly at the cutoff gives next week', () => {
    expect(sunday18('2026-11-15T17:00:00.000Z')).toBe('2026-11-22T17:00:00.000Z')
  })

  it('same day, earlier hour gives today', () => {
    expect(sunday18('2026-11-15T16:59:59.999Z')).toBe('2026-11-15T17:00:00.000Z')
  })

  it('uses the Prague day: Sunday 23:30 UTC is Monday in Prague', () => {
    expect(nextPragueWeekdayAt(utc('2026-11-15T23:30:00.000Z'), 1, 7).toISOString()).toBe(
      '2026-11-16T06:00:00.000Z',
    )
  })

  it('lands on the DST-switch Sundays at the right offset', () => {
    expect(sunday18('2026-03-27T12:00:00.000Z')).toBe('2026-03-29T16:00:00.000Z')
    expect(sunday18('2026-10-23T12:00:00.000Z')).toBe('2026-10-25T17:00:00.000Z')
  })

  it('handles a schedule time inside the spring-forward gap', () => {
    // A 02:30 schedule on 29 March runs at 03:30 CEST that day.
    expect(nextPragueWeekdayAt(utc('2026-03-28T12:00:00.000Z'), 0, 2, 30).toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    )
  })

  it('a schedule at a repeated fall-back hour fires once, at the second 02:30', () => {
    const first = nextPragueWeekdayAt(utc('2026-10-24T12:00:00.000Z'), 0, 2, 30)
    expect(first.toISOString()).toBe('2026-10-25T01:30:00.000Z')
    // Asking again just after the first 02:30 (CEST) still gives the same single run.
    expect(nextPragueWeekdayAt(utc('2026-10-25T00:31:00.000Z'), 0, 2, 30)).toEqual(first)
    // After it, the next run is a week later.
    expect(nextPragueWeekdayAt(first, 0, 2, 30).toISOString()).toBe('2026-11-01T01:30:00.000Z')
  })
})

describe('ISO UTC round trip', () => {
  it('writes and reads back the same instant', () => {
    const d = utc('2026-11-15T17:00:00.000Z')
    expect(parseIsoUtc(toIsoUtc(d))).toEqual(d)
  })

  it.each([
    '2026-11-15T18:00:00+01:00',
    '2026-11-15T17:00:00Z',
    '2026-11-15',
    '2026-02-30T00:00:00.000Z',
    'garbage',
  ])('rejects %s', (value) => {
    expect(() => parseIsoUtc(value)).toThrow(RangeError)
  })

  it('quotes only a short excerpt of a bad value', () => {
    expect(() => parseIsoUtc('x'.repeat(10_000) + '\nfake log line')).toThrow(
      /^Not an ISO UTC instant: "x{40}"$/,
    )
  })

  it('refuses to serialise an invalid date', () => {
    expect(() => toIsoUtc(new Date('nope'))).toThrow(RangeError)
  })
})
