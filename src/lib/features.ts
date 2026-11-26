// Launch switches (family launch 2026-11-22: one-time tasks only; every switch on since
// migration 0022). A switched-off feature keeps its code and routes; only its entry points are
// hidden. A switch can also hold a rule (`settleLastDay`, #211), so it can be turned off by hand
// without a deploy. The values live in the database table `feature_flags` (src/server/features); the app
// shell reads them on every page load and screens get them as `context.features`. A new
// unfinished feature gets a new switch, off, and turns it on when its issue lands.
/** The switches, in the order the seed migration writes them. */
export const FEATURE_KEYS = [
  /** Recurring templates: the Opakovaný kind, template lists, approvals and price changes (#38). */
  'recurring',
  /** Bottom-bar tabs, hidden while their screens were placeholders: Zapsat (#38), Týden (#45),
   * Schůzka (#44). */
  'log',
  'week',
  'meeting',
  /** Proposals for next week and for the default week (#43). */
  'periodProposals',
  /** Disputes and corrections (#46–#48), one switch for both (Jakub 2026-11-22). */
  'disputes',
  /** Settle the running week only on its last day (#211). On from its migration (0027):
   * Jakub 2026-11-24, "flip once merged". */
  'settleLastDay',
  /** Changing your own password on Profil (#210). */
  'passwordChange',
  /** Bidding: a brother's Nechci and a parent's turn-down (#208). */
  'bidRefusals',
  /** Approve done work from the task page and Úkoly; Ke schválení first on a parent's Domů
   * (#206). */
  'approveAnywhere',
  'reopenBidding',
  /** Bidding on a proposed recurring chore's first price (#209). */
  'choreBidding',
  /** Rows open their task or chore page (#205). */
  'openRows',
  /** Descriptions on tasks and chores (#207). */
  'descriptions',
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
}

/** Every switch on: the full app as designed (UI doc §6). */
export const ALL_FEATURES: Readonly<Features> = {
  recurring: true,
  log: true,
  week: true,
  meeting: true,
  periodProposals: true,
  disputes: true,
  settleLastDay: true,
  passwordChange: true,
  bidRefusals: true,
  approveAnywhere: true,
  reopenBidding: true,
  choreBidding: true,
  openRows: true,
  descriptions: true,
}
