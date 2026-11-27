import { createServerFn } from '@tanstack/react-start'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import { getFlags } from '~/server/features'
import { idTopic } from '~/server/live/topics'
import { liveRead } from '~/server/live/define'
import { serveLive } from '~/server/live/read'
import type { Topic } from '~/server/live/topics'
import { meetingNow, settleNow } from './actions'
import type { Meeting, MeetingTaker, SettleError, ShownTotal } from './meeting'
import { getWeek } from './week'
import type {
  HistoryRecord,
  HistoryWeek,
  Viewer,
  Week,
  WeekAdjustment,
  WeekItem,
  WeekTaker,
} from './week'
import type { CurrentUser } from '~/server/auth/sessions'

export type { Meeting, MeetingTaker, SettleError }
export type { HistoryRecord, HistoryWeek, Week, WeekAdjustment, WeekItem, WeekTaker }

// Server functions for the weekly meeting (#44). Giver only: the guard here, and the domain's
// `settle` again inside (`not_a_giver`). The giver is always the signed-in user, never input.

/** At most this many shown totals: far more than a family has takers. */
const SHOWN_MAX = 20

function int(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Invalid input')
  return value
}

export function parseSettle(data: unknown): { periodId: number; shown: ShownTotal[] } {
  if (typeof data !== 'object' || data === null) throw new Error('Invalid input')
  const { periodId, shown } = data as Record<string, unknown>
  if (!Array.isArray(shown) || shown.length > SHOWN_MAX) throw new Error('Invalid input')
  return {
    periodId: int(periodId),
    shown: shown.map((s: unknown) => {
      if (typeof s !== 'object' || s === null) throw new Error('Invalid input')
      const { takerId, total } = s as Record<string, unknown>
      return { takerId: int(takerId), total: int(total) }
    }),
  }
}

export type { SettleResult } from './actions'

/** The meeting's takers only once it has a week to settle (no rows before). */
export const meetingRead = liveRead({
  read: (db, _viewer, _arg: undefined, now): Meeting => meetingNow(db, now),
  topics: (_viewer, data): Topic[] => [
    'week',
    'people',
    ...(data.period ? data.takers.map((t) => idTopic('points', t.id)) : []),
  ],
})

export const getMeetingFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver')])
  .handler(({ context }) => serveLive(meetingRead, context.user, undefined))

export const settlePeriodFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseSettle)
  .handler(({ data, context }) => settleNow(getDb(), context.user.id, data, new Date()))

/** The week's viewer is always the signed-in user: id and role, nothing else. */
export function viewerOf(user: CurrentUser): Viewer {
  return { id: user.id, role: user.role }
}

// Týden (#45): takers and givers. getWeek filters to the viewer's own data for a taker.
/**
 * A per-taker fact goes only on `points:<taker>` (src/server/live/topics.ts): a giver holds every
 * taker shown, a taker only himself (also with an empty list), never his brother.
 */
export const weekRead = liveRead({
  read: (db, viewer, _arg: undefined, now): Week => getWeek(db, viewerOf(viewer), now),
  topics: (viewer, data, db): Topic[] => {
    const ids = viewer.role === 'taker' ? [viewer.id] : data.takers.map((t) => t.id)
    const disputes = getFlags(db).disputes
    return [
      'week',
      ...(viewer.role === 'taker' ? [] : (['people'] as const)),
      ...ids.map((id) => idTopic('points', id)),
      ...(disputes ? ids.map((id) => idTopic('disputes:about', id)) : []),
    ]
  },
})

export const getWeekFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('taker', 'giver')])
  .handler(({ context }) => serveLive(weekRead, context.user, undefined))
