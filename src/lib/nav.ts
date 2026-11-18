import type { Role } from '~/domain/parties'

// Who sees which screen, and the bottom bar per role (UI doc §6). Framework-free so the whole
// matrix is unit-tested. Server functions still check roles themselves (src/server/auth/guards);
// this only decides navigation.

/** Screens behind login, by path. */
export const APP_PATHS = [
  '/',
  '/zapsat',
  '/tyden',
  '/ukoly',
  '/ukoly/novy',
  '/schuzka',
  '/profil',
  '/sprava',
] as const
export type AppPath = (typeof APP_PATHS)[number]

/** Roles allowed on each screen. Profile is everyone's; Správa is the admin's only screen. */
export const SCREEN_ROLES: Readonly<Record<AppPath, readonly Role[]>> = {
  '/': ['taker', 'giver'],
  '/zapsat': ['taker'],
  '/tyden': ['taker', 'giver'],
  '/ukoly': ['giver'],
  '/ukoly/novy': ['giver'],
  '/schuzka': ['giver'],
  '/profil': ['taker', 'giver', 'admin'],
  '/sprava': ['admin'],
}

export type NavKey = 'home' | 'log' | 'week' | 'tasks' | 'meeting'

export interface NavItem {
  to: AppPath
  /** Key into `cs.nav` and the icon map. */
  key: NavKey
}

const HOME: NavItem = { to: '/', key: 'home' }
const WEEK: NavItem = { to: '/tyden', key: 'week' }

/** Taker: Domů / Zapsat / Týden. Giver: Domů / Úkoly / Schůzka / Týden. Admin: no bar. */
export function navItems(role: Role): readonly NavItem[] {
  switch (role) {
    case 'taker':
      return [HOME, { to: '/zapsat', key: 'log' }, WEEK]
    case 'giver':
      return [HOME, { to: '/ukoly', key: 'tasks' }, { to: '/schuzka', key: 'meeting' }, WEEK]
    case 'admin':
      return []
  }
}

export function canSee(role: Role, path: AppPath): boolean {
  return SCREEN_ROLES[path].includes(role)
}
