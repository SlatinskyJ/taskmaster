import { describe, expect, it } from 'vitest'
import { fromPragueWallTime, toIsoUtc } from '~/domain/dates'
import { dayTime, levelLabel, shortfall, untilLabel, weekLabel } from './meetingView'

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

describe('shortfall', () => {
  it.each([
    [49, 'Chyběl 1 bod. Nic nepropadá, 49 bodů jde do dalšího týdne.'],
    [47, 'Chyběly 3 body. Nic nepropadá, 47 bodů jde do dalšího týdne.'],
    [3, 'Chybělo 47 bodů. Nic nepropadá, 3 body jdou do dalšího týdne.'],
    [48, 'Chyběly 2 body. Nic nepropadá, 48 bodů jde do dalšího týdne.'],
    [1, 'Chybělo 49 bodů. Nic nepropadá, 1 bod jde do dalšího týdne.'],
  ])('%i of 50 → %s', (total, text) => {
    expect(shortfall(total, 50)).toBe(text)
  })

  it.each([0, 50, 130, -5])('%i → nothing to say', (total) => {
    expect(shortfall(total, 50)).toBeNull()
  })
})

describe('dayTime and untilLabel', () => {
  it('winter time', () => {
    expect(dayTime(at(11, 29, 20))).toBe('ne 29. 11. 20:00')
    expect(untilLabel(at(11, 29, 23, 59))).toBe('neděle 29. 11. 23:59')
    expect(untilLabel(at(11, 26, 9, 5))).toBe('čtvrtka 26. 11. 09:05')
  })

  it('summer time', () => {
    expect(dayTime(at(6, 7, 8, 30))).toBe('ne 7. 6. 08:30')
    expect(untilLabel(at(6, 6, 23, 59))).toBe('soboty 6. 6. 23:59')
  })
})
