// The demo family's accounts (previews and the public demo): the seed creates them, the
// /dev/multi viewer and the demo's login page log in as them. Framework-free, so the seed and
// the screens share one list.

export const DEMO_LOGINS = ['admin', 'tata', 'starsi', 'mladsi'] as const
export type DemoLogin = (typeof DEMO_LOGINS)[number]

/**
 * Known on purpose: previews are tailnet-only and the public demo is for anyone; neither holds
 * real data, and the demo locks password changes (src/server/demo/lock.ts). It ships in the
 * client bundle and opens nothing in production: a real deploy sets ADMIN_PASSWORD, so the demo
 * seed refuses and no account has this password.
 */
export const DEMO_PASSWORD = 'demo1234'

/** The message of the refusal a locked server function throws on the public demo. */
export const DEMO_LOCKED = 'demo_locked'
