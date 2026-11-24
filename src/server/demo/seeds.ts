import { FEATURE_KEYS } from '~/lib/features'
import type { FeatureKey } from '~/lib/features'
import {
  bootTick,
  cancelled,
  corrections,
  disputes,
  instances,
  negotiation,
  pastWeek,
  pastWeekScheduled,
  points,
  priceChange,
  proposals,
  templates,
  thisWeek,
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
  rows: { pieces: [negotiation, points, templates], features: ['recurring', 'openRows'] },
  /** The task page (#36). */
  tasks: { pieces: [priceChange], features: [] },
  /** Týden and the weekly meeting (#44, #45). */
  week: { pieces: [pastWeek, thisWeek], features: ['week', 'meeting'] },
  /** Recurring chores made by a person (#38): + Teď and Zapsat. */
  recurring: { pieces: [points, templates, instances], features: ['recurring', 'log'] },
  /** The scheduler (#39): everyday templates through the past week, then the boot tick. */
  scheduler: { pieces: [pastWeekScheduled, bootTick], features: ['recurring'] },
  /** Příští týden and Výchozí týden (#43): an open proposal of each kind. */
  proposals: { pieces: [thisWeek, proposals], features: ['week', 'periodProposals'] },
  /** Disputes (#46): a confirmed and a rejected item this week, a settled past week. */
  disputes: { pieces: [pastWeek, thisWeek, disputes], features: ['week', 'disputes'] },
  /** Corrections and adjustments (#48): the disputes, then a manual +5 and a corrected week. */
  corrections: {
    pieces: [pastWeek, thisWeek, disputes, corrections],
    features: ['week', 'disputes'],
  },
  /** Previews and dev: everything. */
  demo: {
    pieces: [
      pastWeekScheduled,
      negotiation,
      priceChange,
      cancelled,
      points,
      templates,
      thisWeek,
      disputes,
      corrections,
      instances,
      proposals,
      bootTick,
    ],
    features: FEATURE_KEYS,
  },
} as const satisfies Record<string, Seed>

export type SeedName = keyof typeof SEEDS

export function isSeedName(name: string): name is SeedName {
  return Object.hasOwn(SEEDS, name)
}
