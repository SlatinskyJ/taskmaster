import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import type { ProposalView, ProposalsView } from '~/server/periods/functions'

// Příští týden fixtures: the running week 22.–29. 11., next week from Sun 29 Nov 23:59.
// Ids: Táta 2 (giver), Starší 3, Mladší 4 (takers), Máma 5 (giver).

export const TATA = 2
export const STARSI = 3
export const MLADSI = 4
export const MAMA = 5

export const LONG_NAME = 'Bartoloměj Vyskočil-Nováček'

const NEXT_START = '2026-11-29T22:59:00.000Z'
const DEFAULT_END = '2026-12-06T22:59:00.000Z'

type PeriodProposal = NonNullable<ProposalsView['period']>

export function periodProposal(over: Partial<PeriodProposal> = {}): PeriodProposal {
  return {
    id: 1,
    // Sat 5 Dec 20:00, 60/120.
    settings: { cutoffAt: '2026-12-05T19:00:00.000Z', levels: { lower: 60, upper: 120 } },
    proposedBy: STARSI,
    approvedBy: [STARSI],
    status: 'pending',
    waitingFor: [TATA, MLADSI],
    ...over,
  }
}

export function defaultsProposal(
  over: Partial<ProposalView<ProposalsView['currentDefaults']>> = {},
): NonNullable<ProposalsView['defaults']> {
  return {
    id: 1,
    settings: { ...DEFAULT_PERIOD_DEFAULTS, lengthDays: 14, levels: { lower: 60, upper: 120 } },
    proposedBy: TATA,
    approvedBy: [TATA],
    status: 'pending',
    waitingFor: [STARSI, MLADSI],
    ...over,
  }
}

export function proposalsView(over: Partial<ProposalsView> = {}): ProposalsView {
  return {
    period: null,
    defaults: null,
    running: {
      startsAt: '2026-11-21T19:00:00.000Z',
      cutoffAt: NEXT_START,
      levels: { lower: 50, upper: 100 },
    },
    next: { startsAt: NEXT_START, cutoffAt: DEFAULT_END, levels: { lower: 50, upper: 100 } },
    defaultNext: { startsAt: NEXT_START, cutoffAt: DEFAULT_END, levels: { lower: 50, upper: 100 } },
    currentDefaults: DEFAULT_PERIOD_DEFAULTS,
    parties: [
      { id: TATA, name: 'Táta', role: 'giver' },
      { id: STARSI, name: 'Starší', role: 'taker' },
      { id: MLADSI, name: 'Mladší', role: 'taker' },
    ],
    ...over,
  }
}
