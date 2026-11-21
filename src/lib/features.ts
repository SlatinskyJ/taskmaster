// Launch switches (family launch 2026-11-22: one-time tasks only). A switched-off feature keeps
// its code and routes; only its entry points are hidden. The values live in the database table
// `feature_flags` (src/server/features); the app shell reads them on every page load and screens
// get them as `context.features`. Turn a switch on when its issue lands.
/** The switches, in the order the seed migration writes them. */
export const FEATURE_KEYS = [
  /** Recurring templates: the Opakovaný kind, template lists, approvals and price changes (#38). */
  'recurring',
  /** Bottom-bar tabs whose screens are still placeholders. */
  'log',
  'week',
  'meeting',
] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number]

/** One on/off per switch; a key added to FEATURE_KEYS is a key here too. */
export type Features = Record<FeatureKey, boolean>

/** Every switch off: what a switch with no row in the database reads as. */
export const NO_FEATURES: Readonly<Features> = {
  recurring: false,
  log: false,
  week: false,
  meeting: false,
}

/** Every switch on: the full app as designed (UI doc §6). */
export const ALL_FEATURES: Readonly<Features> = {
  recurring: true,
  log: true,
  week: true,
  meeting: true,
}
