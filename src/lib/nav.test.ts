import { describe, expect, it } from 'vitest'
import { ROLES } from '~/domain/parties'
import { landingPath } from './landing'
import { ALL_FEATURES, NO_FEATURES } from './features'
import { APP_PATHS, canSee, navItems, showsBar } from './nav'
import { cs } from './strings'

describe('navItems (UI doc §6)', () => {
  it('taker: Domů / Zapsat / Týden', () => {
    expect(navItems('taker', ALL_FEATURES).map((i) => cs.nav[i.key])).toEqual([
      'Domů',
      'Zapsat',
      'Týden',
    ])
  })

  it('giver: Domů / Úkoly / Schůzka / Týden', () => {
    expect(navItems('giver', ALL_FEATURES).map((i) => cs.nav[i.key])).toEqual([
      'Domů',
      'Úkoly',
      'Schůzka',
      'Týden',
    ])
  })

  it('launch (every switch off): Zapsat, Týden and Schůzka are hidden', () => {
    expect(navItems('taker', NO_FEATURES).map((i) => cs.nav[i.key])).toEqual(['Domů'])
    expect(navItems('giver', NO_FEATURES).map((i) => cs.nav[i.key])).toEqual(['Domů', 'Úkoly'])
  })

  it('each placeholder tab follows its own switch', () => {
    const only = (key: 'log' | 'week' | 'meeting') => ({
      recurring: false,
      log: key === 'log',
      week: key === 'week',
      meeting: key === 'meeting',
      periodProposals: false,
      disputes: false,
      settleLastDay: false,
      passwordChange: false,
      bidRefusals: false,
      approveAnywhere: false,
      reopenBidding: false,
      choreBidding: false,
      openRows: false,
      descriptions: false,
      weekPlan: false,
      suggestions: false,
      liveChanges: false,
    })
    expect(navItems('taker', only('log')).map((i) => i.key)).toEqual(['home', 'log'])
    expect(navItems('taker', only('week')).map((i) => i.key)).toEqual(['home', 'week'])
    expect(navItems('giver', only('meeting')).map((i) => i.key)).toEqual([
      'home',
      'tasks',
      'meeting',
    ])
  })

  it('admin has no bar', () => {
    expect(navItems('admin', ALL_FEATURES)).toEqual([])
  })

  it.each(ROLES)('every %s nav target is a screen that role may see', (role) => {
    for (const item of navItems(role, ALL_FEATURES)) expect(canSee(role, item.to)).toBe(true)
  })
})

describe('canSee', () => {
  const matrix: Record<(typeof APP_PATHS)[number], string> = {
    '/': 'taker giver',
    '/zapsat': 'taker',
    '/tyden': 'taker giver',
    '/tyden/pristi': 'taker giver',
    '/tyden/vychozi': 'giver',
    '/tyden/plan': 'taker giver',
    '/ukoly': 'giver',
    '/ukoly/novy': 'giver',
    '/schuzka': 'giver',
    '/profil': 'taker giver admin',
    '/sprava': 'admin',
    '/klic': 'taker giver admin',
    '/ukol/$taskId': 'taker giver',
    '/sablona/$templateId': 'taker giver',
  }

  it.each(APP_PATHS)('%s is visible to exactly its roles', (path) => {
    const allowed = ROLES.filter((r) => canSee(r, path)).join(' ')
    expect(allowed).toBe(matrix[path])
  })

  it('the task page is for brothers and parents, not the admin (#34)', () => {
    expect(ROLES.filter((r) => canSee(r, '/ukol/$taskId'))).toEqual(['taker', 'giver'])
  })

  it.each(ROLES)('%s may see its landing page', (role) => {
    expect(canSee(role, landingPath(role))).toBe(true)
  })
})

describe('showsBar', () => {
  it("the passkey offer is a full screen: in nobody's bar, no bar on it", () => {
    for (const role of ROLES) {
      expect(navItems(role, ALL_FEATURES).map((i) => i.to)).not.toContain('/klic')
      expect(showsBar(role, '/klic', ALL_FEATURES)).toBe(false)
    }
  })

  it('takers and givers have the bar elsewhere; the admin never', () => {
    expect(showsBar('taker', '/', ALL_FEATURES)).toBe(true)
    expect(showsBar('giver', '/profil', ALL_FEATURES)).toBe(true)
    expect(showsBar('admin', '/sprava', ALL_FEATURES)).toBe(false)
  })

  it('a single tab is no bar: a launch taker has only Domů', () => {
    expect(showsBar('taker', '/', NO_FEATURES)).toBe(false)
    expect(showsBar('giver', '/', NO_FEATURES)).toBe(true)
  })
})
