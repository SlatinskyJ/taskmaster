import { FEATURE_KEYS } from '~/lib/features'
import type { FeatureKey } from '~/lib/features'
import {
  bootTick,
  cancelled,
  choreBidding,
  choreChange,
  corrections,
  choreDispute,
  descriptions,
  disputes,
  endedWeek,
  instances,
  negotiation,
  pastWeek,
  pastWeekScheduled,
  planTable,
  points,
  priceChange,
  proposals,
  rebidding,
  suggestions,
  templates,
  thisWeek,
  weekChores,
} from './pieces'
import type { Piece } from './pieces'

// Named seeds (#183): `TASKMASTER_SEED` picks one at boot, default `demo`. Each lists its pieces
// (./pieces.ts, in order: `pastWeek` first, as it writes a week back) and the launch switches it
// turns on (every other switch goes off). Previews get `demo`: every piece and every switch.
// Each e2e spec file names its seed in e2e/suites.ts. A feature PR adds its piece to `demo` and,
// if its suite needs it, to that suite's seed (a new seed for a new suite); a feature behind a
// switch lists the switch there.

export interface Seed {
  pieces: readonly Piece[]
  features: readonly FeatureKey[]
}

export const SEEDS = {
  /** Just the family (passkey suites). */
  family: { pieces: [], features: [] },
  /** Domů and Úkoly (#40, #41). */
  home: { pieces: [negotiation, points], features: [] },
  /** The launch look (#163): must stay with every switch off, whatever other suites turn on. */
  launch: { pieces: [negotiation, points], features: [] },
  /** Done work to approve on Úkoly and the task page (#206). */
  approve: { pieces: [negotiation, points], features: ['approveAnywhere'] },
  /** Rows that open their task or chore page (#205). */
  rows: {
    pieces: [negotiation, points, templates, instances],
    features: ['recurring', 'week', 'openRows'],
  },
  /** The task page (#36). */
  tasks: { pieces: [priceChange], features: [] },
  /** Saying no in bidding (#208): "Umýt auto" with two bids, the refusals switch on. */
  bids: { pieces: [negotiation], features: ['bidRefusals'] },
  /** Reopened bidding (#212): a round with a bid, a free task to reopen; turn-down needs refusals. */
  rebid: { pieces: [rebidding], features: ['reopenBidding', 'bidRefusals'] },
  /** Týden and the weekly meeting (#44, #45). */
  week: { pieces: [pastWeek, thisWeek], features: ['week', 'meeting'] },
  /** Recurring chores made by a person (#38): + Teď and Zapsat. */
  recurring: { pieces: [points, templates, instances], features: ['recurring', 'log'] },
  /** Bidding on a proposed chore (#209): two proposed chores, one with two bids. */
  chores: { pieces: [choreBidding], features: ['recurring', 'choreBidding'] },
  /** Saying no on an agreed chore's price change (#232): "Umýt koupelnu" with two bids. */
  chorechange: { pieces: [choreChange], features: ['recurring', 'bidRefusals'] },
  /** The scheduler (#39): everyday templates through the past week, then the boot tick. */
  scheduler: { pieces: [pastWeekScheduled, bootTick], features: ['recurring'] },
  /** Příští týden and Výchozí týden (#43): an open proposal of each kind. */
  proposals: { pieces: [thisWeek, proposals], features: ['week', 'periodProposals'] },
  /**
   * Disputes (#46): a confirmed and a rejected item this week, a settled past week, and the
   * agreed chores with "Vyndat myčku" in dispute (#222: a chore card on Sporné).
   */
  disputes: {
    pieces: [pastWeek, thisWeek, templates, disputes, choreDispute],
    features: ['week', 'disputes', 'recurring'],
  },
  /** Corrections and adjustments (#48): the disputes, then a manual +5 and a corrected week. */
  corrections: {
    pieces: [pastWeek, thisWeek, disputes, corrections],
    features: ['week', 'disputes'],
  },
  /** Descriptions (#207): a proposed and an open task with a text, one with a change waiting. */
  descriptions: {
    pieces: [descriptions, points],
    features: ['descriptions', 'openRows', 'recurring'],
  },
  /** Changing your own password on Profil (#210): the demo people, the switch on. */
  password: { pieces: [], features: ['passwordChange'] },
  /** The week plan (#257): the week's chore copies, Domů and Zapsat by their day. */
  weekplan: { pieces: [weekChores, points], features: ['recurring', 'log', 'weekPlan'] },
  /** The plan table on Týden (#258): four chores, yesterday's and today's copies in each state. */
  plantable: { pieces: [planTable], features: ['recurring', 'week', 'weekPlan'] },
  /**
   * The week plan at Schůzka (#259): an ended week to settle on any weekday with the last-day
   * rule on, a running week from today 00:00, and the plan table's chores with every copy.
   */
  planmeeting: {
    pieces: [endedWeek],
    features: ['recurring', 'week', 'meeting', 'weekPlan', 'settleLastDay'],
  },
  /** Suggestions on Profil and Správa (#247): two new, one done, one dismissed. */
  suggestions: { pieces: [suggestions], features: ['suggestions'] },
  /** Previews and dev: everything. */
  demo: {
    pieces: [
      pastWeekScheduled,
      negotiation,
      priceChange,
      rebidding,
      cancelled,
      points,
      templates,
      choreBidding,
      choreChange,
      thisWeek,
      disputes,
      corrections,
      choreDispute,
      instances,
      proposals,
      bootTick,
      // Last, so the other pieces keep their ids (e2e opens pages by id).
      descriptions,
      weekChores,
      planTable,
      suggestions,
    ],
    features: FEATURE_KEYS,
  },
} as const satisfies Record<string, Seed>

export type SeedName = keyof typeof SEEDS

export function isSeedName(name: string): name is SeedName {
  return Object.hasOwn(SEEDS, name)
}
