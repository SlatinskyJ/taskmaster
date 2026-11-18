import type { Role } from '~/domain/parties'

// Who sees which screen (UI doc §6, spec §3). The bottom bar and each route's guard both read
// this table, so a tab can never lead to a screen its role is refused.

export const APP_PATHS = [
  '/',
  '/zapsat',
  '/tyden',
  '/ukoly',
  '/schuzka',
  '/sprava',
  '/profil',
] as const
export type AppPath = (typeof APP_PATHS)[number]

const ALL: readonly Role[] = ['taker', 'giver', 'admin']

/** Roles allowed on each screen. Profile is everyone's; Správa is the admin's only screen. */
export const SCREEN_ROLES: Record<AppPath, readonly Role[]> = {
  '/': ['taker', 'giver'],
  '/zapsat': ['taker'],
  '/tyden': ['taker', 'giver'],
  '/ukoly': ['giver'],
  '/schuzka': ['giver'],
  '/sprava': ['admin'],
  '/profil': ALL,
}

export type NavKey = 'home' | 'log' | 'week' | 'tasks' | 'meeting'

export interface NavItem {
  key: NavKey
  to: AppPath
}

/** Bottom bar per role, in order (UI doc §6). The admin has none. */
export const NAV: Record<Role, readonly NavItem[]> = {
  taker: [
    { key: 'home', to: '/' },
    { key: 'log', to: '/zapsat' },
    { key: 'week', to: '/tyden' },
  ],
  giver: [
    { key: 'home', to: '/' },
    { key: 'tasks', to: '/ukoly' },
    { key: 'meeting', to: '/schuzka' },
    { key: 'week', to: '/tyden' },
  ],
  admin: [],
}

export function canOpen(role: Role, path: AppPath): boolean {
  return SCREEN_ROLES[path].includes(role)
}
