import { describe, expect, it } from 'vitest'
import { ROLES } from '~/domain/parties'
import { landingPath } from './landing'
import { APP_PATHS, NAV, canOpen } from './nav'

describe('NAV', () => {
  it('gives takers Domů / Zapsat / Týden', () => {
    expect(NAV.taker.map((i) => i.to)).toEqual(['/', '/zapsat', '/tyden'])
  })

  it('gives givers Domů / Úkoly / Schůzka / Týden', () => {
    expect(NAV.giver.map((i) => i.to)).toEqual(['/', '/ukoly', '/schuzka', '/tyden'])
  })

  it('gives the admin no bottom bar', () => {
    expect(NAV.admin).toEqual([])
  })

  it.each(ROLES)('never shows %s a tab it may not open', (role) => {
    for (const item of NAV[role]) expect(canOpen(role, item.to)).toBe(true)
  })
})

describe('canOpen', () => {
  it.each([
    ['taker', '/zapsat', true],
    ['giver', '/zapsat', false],
    ['taker', '/ukoly', false],
    ['taker', '/schuzka', false],
    ['giver', '/schuzka', true],
    ['admin', '/', false],
    ['admin', '/tyden', false],
    ['taker', '/sprava', false],
    ['giver', '/sprava', false],
    ['admin', '/sprava', true],
  ] as const)('%s on %s → %s', (role, path, expected) => {
    expect(canOpen(role, path)).toBe(expected)
  })

  it.each(ROLES)('lets %s open the profile', (role) => {
    expect(canOpen(role, '/profil')).toBe(true)
  })

  it.each(ROLES)('lets %s open its own landing screen', (role) => {
    expect(canOpen(role, landingPath(role))).toBe(true)
  })

  it('knows every path', () => {
    for (const path of APP_PATHS) expect(ROLES.some((r) => canOpen(r, path))).toBe(true)
  })
})
