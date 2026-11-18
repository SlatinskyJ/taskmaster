import { describe, expect, it } from 'vitest'
import { ROLES } from '~/domain/parties'
import { landingPath } from './landing'
import { APP_PATHS, canSee, navItems } from './nav'
import { cs } from './strings'

describe('navItems (UI doc §6)', () => {
  it('taker: Domů / Zapsat / Týden', () => {
    expect(navItems('taker').map((i) => cs.nav[i.key])).toEqual(['Domů', 'Zapsat', 'Týden'])
  })

  it('giver: Domů / Úkoly / Schůzka / Týden', () => {
    expect(navItems('giver').map((i) => cs.nav[i.key])).toEqual([
      'Domů',
      'Úkoly',
      'Schůzka',
      'Týden',
    ])
  })

  it('admin has no bar', () => {
    expect(navItems('admin')).toEqual([])
  })

  it.each(ROLES)('every %s nav target is a screen that role may see', (role) => {
    for (const item of navItems(role)) expect(canSee(role, item.to)).toBe(true)
  })
})

describe('canSee', () => {
  const matrix: Record<(typeof APP_PATHS)[number], string> = {
    '/': 'taker giver',
    '/zapsat': 'taker',
    '/tyden': 'taker giver',
    '/ukoly': 'giver',
    '/schuzka': 'giver',
    '/profil': 'taker giver admin',
    '/sprava': 'admin',
  }

  it.each(APP_PATHS)('%s is visible to exactly its roles', (path) => {
    const allowed = ROLES.filter((r) => canSee(r, path)).join(' ')
    expect(allowed).toBe(matrix[path])
  })

  it.each(ROLES)('%s may see its landing page', (role) => {
    expect(canSee(role, landingPath(role))).toBe(true)
  })
})
