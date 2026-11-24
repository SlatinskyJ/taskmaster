import type { Week, WeekItem } from '~/server/settlement/functions'

// Week screen fixtures (#45): the demo family, Starší 3, Mladší 4.

export const item = (over: Partial<WeekItem> = {}): WeekItem => ({
  taskId: 10,
  title: 'Vyluxovat celý obývák a chodbu',
  score: 8,
  status: 'confirmed',
  at: '2026-11-24T17:00:00.000Z',
  reason: null,
  dispute: { item: { kind: 'completion', id: over.taskId ?? 10 }, mark: null },
  ...over,
})

export function week(over: Partial<Week> = {}): Week {
  return {
    period: {
      id: 2,
      startsAt: '2026-11-21T19:00:00.000Z',
      cutoffAt: '2026-11-29T22:59:00.000Z',
      levels: { lower: 50, upper: 100 },
    },
    takers: [
      {
        id: 3,
        name: 'Starší',
        confirmed: 112,
        pending: 2,
        carriedIn: 8,
        unsettled: 0,
        items: [
          item({
            taskId: 11,
            title: 'Zalít kytky',
            score: 2,
            status: 'done_unconfirmed',
            dispute: undefined,
          }),
          item(),
          item({
            taskId: 12,
            title: 'Vynést sklo',
            score: 4,
            status: 'rejected',
            reason: 'nádobí zůstalo v dřezu',
            dispute: { item: { kind: 'rejection', id: 90 }, mark: null },
          }),
        ],
        adjustments: [],
      },
      {
        id: 4,
        name: 'Mladší',
        confirmed: 47,
        pending: 0,
        carriedIn: 0,
        unsettled: 0,
        items: [],
        adjustments: [],
      },
    ],
    history: [
      {
        periodId: 1,
        startsAt: '2026-11-14T19:00:00.000Z',
        endsAt: '2026-11-21T19:00:00.000Z',
        levels: { lower: 50, upper: 100 },
        records: [
          {
            id: 21,
            takerId: 3,
            name: 'Starší',
            totalBefore: 108,
            level: 'upper',
            deducted: 100,
            carryOver: 8,
            dispute: null,
            correction: null,
            adjustments: [],
          },
          {
            id: 22,
            takerId: 4,
            name: 'Mladší',
            totalBefore: 50,
            level: 'lower',
            deducted: 50,
            carryOver: 0,
            dispute: null,
            correction: null,
            adjustments: [],
          },
        ],
      },
    ],
    ...over,
  }
}

/** What a taker's loader gets: only his own card and records. */
export function takerWeek(): Week {
  const w = week()
  return {
    ...w,
    takers: w.takers.filter((t) => t.id === 3),
    history: w.history.map((h) => ({ ...h, records: h.records.filter((r) => r.takerId === 3) })),
  }
}
