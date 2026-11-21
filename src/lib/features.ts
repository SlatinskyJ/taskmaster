// Launch switches (family launch 2026-11-22: one-time tasks only). A switched-off feature keeps
// its code and routes; only its entry points are hidden. Turn a switch on when its issue lands.
export interface Features {
  /** Recurring templates: the Opakovaný kind, template lists, approvals and price changes (#38). */
  recurring: boolean
  /** Bottom-bar tabs whose screens are still placeholders. */
  log: boolean
  week: boolean
  meeting: boolean
}

export const FEATURES: Readonly<Features> = {
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
