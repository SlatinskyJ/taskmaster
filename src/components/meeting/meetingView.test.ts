import { describe, expect, it } from 'vitest'
import { fromPragueWallTime, toIsoUtc } from '~/domain/dates'
import { shortfall, untilLabel } from './meetingView'

const at = (month: number, day: number, hour = 0, minute = 0) =>
  toIsoUtc(fromPragueWallTime({ year: 2026, month, day, hour, minute }))

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

describe('untilLabel', () => {
  it('winter time', () => {
    expect(untilLabel(at(11, 29, 23, 59))).toBe('neděle 29. 11. 23:59')
    expect(untilLabel(at(11, 26, 9, 5))).toBe('čtvrtka 26. 11. 09:05')
  })

  it('summer time', () => {
    expect(untilLabel(at(6, 6, 23, 59))).toBe('soboty 6. 6. 23:59')
  })
})
