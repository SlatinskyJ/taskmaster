import type { PlanCopy, WeekPlan } from '~/server/instances/functions'
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

// ── The plan table (#258) ─────────────────────────────────────────────────────────────────

/** Prague day starts: Sunday 29. 11. … Sunday 6. 12. (a Sunday-evening week has 8 days). */
export const PLAN_DAYS = [
  '2026-11-28T23:00:00.000Z',
  '2026-11-29T23:00:00.000Z',
  '2026-11-30T23:00:00.000Z',
  '2026-12-01T23:00:00.000Z',
  '2026-12-02T23:00:00.000Z',
  '2026-12-03T23:00:00.000Z',
  '2026-12-04T23:00:00.000Z',
  '2026-12-05T23:00:00.000Z',
]
/** Wednesday 2. 12. */
export const PLAN_TODAY = PLAN_DAYS[3] ?? ''

export const planCopy = (over: Partial<PlanCopy> = {}): PlanCopy => ({
  id: 100,
  status: 'open',
  score: 2,
  origin: 'scheduled',
  createdAt: '2026-11-29T19:00:00.000Z',
  person: null,
  ...over,
})

const STARSI = { id: 3, name: 'Starší' }
const MLADSI = { id: 4, name: 'Mladší' }

/**
 * Two chores over 8 days, seen by Starší (id 3). "Prostřít stůl k večeři": Sun blank, Mon
 * expired, Tue confirmed (Starší), Wed (today) free, Thu mine, Fri Mladší's, Sat pending
 * (Mladší), Sun cancelled. "Vyluxovat celý obývák a chodbu": two copies today, the rest blank.
 */
export function planFixture(over: Partial<WeekPlan> = {}): WeekPlan {
  return {
    period: { startsAt: '2026-11-29T19:00:00.000Z', cutoffAt: '2026-12-06T19:00:00.000Z' },
    today: PLAN_TODAY,
    days: PLAN_DAYS,
    rows: [
      {
        templateId: 1,
        title: 'Prostřít stůl k večeři',
        scheduleDays: [0, 1, 2, 3, 4, 5, 6],
        cells: [
          [],
          [planCopy({ id: 101, status: 'expired' })],
          [planCopy({ id: 102, status: 'confirmed', person: STARSI })],
          [planCopy({ id: 103 })],
          [planCopy({ id: 104, status: 'reserved', person: STARSI })],
          [planCopy({ id: 105, status: 'reserved', person: MLADSI })],
          [planCopy({ id: 106, status: 'done_unconfirmed', person: MLADSI })],
          [planCopy({ id: 107, status: 'cancelled' })],
        ],
      },
      {
        templateId: 2,
        title: 'Vyluxovat celý obývák a chodbu',
        scheduleDays: [2, 5],
        cells: [
          [],
          [],
          [],
          [
            planCopy({ id: 201, score: 6 }),
            planCopy({
              id: 202,
              score: 6,
              origin: 'on_demand',
              createdAt: '2026-12-02T13:20:00.000Z',
              status: 'reserved',
              person: STARSI,
            }),
          ],
          [],
          [],
          [],
          [],
        ],
      },
    ],
    ...over,
  }
}
