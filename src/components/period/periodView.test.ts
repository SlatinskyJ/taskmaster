import { describe, expect, it } from 'vitest'
import { fromPragueWallTime, toIsoUtc } from '~/domain/dates'
import { dayLabel, dayTime, levelBadgeClass, levelLabel, weekLabel } from './periodView'

const at = (month: number, day: number, hour = 0, minute = 0) =>
  toIsoUtc(fromPragueWallTime({ year: 2026, month, day, hour, minute }))

describe('weekLabel', () => {
  it('a week from its start day to its end day', () => {
    expect(weekLabel(at(11, 22), at(11, 29, 23, 59))).toBe('22. 11. – 29. 11.')
  })

  it('week label for an ended week uses its end', () => {
    expect(weekLabel(at(11, 22), at(11, 29, 20))).toBe('22. 11. – 29. 11.')
    expect(weekLabel(at(11, 22), at(11, 26, 20))).toBe('22. 11. – 26. 11.')
  })

  it('across a month end', () => {
    expect(weekLabel(at(11, 29, 20), at(12, 6, 23, 59))).toBe('29. 11. – 6. 12.')
  })

  it('the Prague day wins over the UTC day', () => {
    // Sun 23:59 Prague is Sun 22:59 UTC; Mon 00:30 Prague is still Sun 23:30 UTC.
    expect(weekLabel(at(11, 30, 0, 30), at(12, 6, 23, 59))).toBe('30. 11. – 6. 12.')
    expect(at(11, 30, 0, 30)).toBe('2026-11-29T23:30:00.000Z')
  })

  it('a 00:00 cutoff ends the week on the day before', () => {
    // Fri 27. 11. 00:00 → Fri 4. 12. 00:00: the last day is Thu 3. 12.
    expect(weekLabel(at(11, 27), at(12, 4))).toBe('27. 11. – 3. 12.')
    // Across a month end, and one minute later the cutoff day counts again.
    expect(weekLabel(at(11, 24), at(12, 1))).toBe('24. 11. – 30. 11.')
    expect(weekLabel(at(11, 24), at(12, 1, 0, 1))).toBe('24. 11. – 1. 12.')
    // A few seconds past 00:00 is already the cutoff day.
    expect(weekLabel(at(11, 24), '2026-11-30T23:00:05.000Z')).toBe('24. 11. – 1. 12.')
  })

  it('a 00:00 cutoff the day after the March DST switch (a 23-hour day)', () => {
    expect(weekLabel(at(3, 23), at(3, 30))).toBe('23. 3. – 29. 3.')
  })

  it('the October DST week', () => {
    expect(weekLabel(at(10, 18, 23, 59), at(10, 25, 23, 59))).toBe('18. 10. – 25. 10.')
  })
})

describe('levelLabel', () => {
  it.each([
    ['upper', 'Horní hranice'],
    ['lower', 'Spodní hranice'],
    ['none', 'Bez kapesného'],
  ] as const)('%s → %s', (level, label) => {
    expect(levelLabel(level)).toBe(label)
  })
})

describe('dayTime and dayLabel', () => {
  it('winter time', () => {
    expect(dayTime(at(11, 29, 20))).toBe('ne 29. 11. 20:00')
    expect(dayLabel(at(11, 25, 9))).toBe('st 25. 11.')
  })

  it('summer time', () => {
    expect(dayTime(at(6, 7, 8, 30))).toBe('ne 7. 6. 08:30')
  })

  it('the Prague day wins over the UTC day', () => {
    expect(dayLabel('2026-11-24T23:30:00.000Z')).toBe('st 25. 11.')
  })
})

describe('levelBadgeClass', () => {
  it('a distinct colour per level', () => {
    expect(
      new Set([levelBadgeClass('upper'), levelBadgeClass('lower'), levelBadgeClass('none')]).size,
    ).toBe(3)
    expect(levelBadgeClass('upper')).toContain('state-confirmed')
  })
})
