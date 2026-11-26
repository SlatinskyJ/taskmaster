import { createServerFn } from '@tanstack/react-start'
import { requireRole } from '~/server/auth/guards'
import { idTopic, liveRead, serveLive } from '~/server/live'
import type { Topic } from '~/server/live'
import type { PointsOverview, TakerPoints } from './points'
import { pointsView } from './points'

export type { PointsOverview, TakerPoints }

// Points for Domů (#40, spec §5.7). The handler is exactly `pointsView` (tested in points).

/** A giver: every taker shown and the list of them; a taker: his own points only. */
export const pointsRead = liveRead({
  read: (db, viewer, _arg: undefined, now): PointsOverview => pointsView(db, viewer, now),
  topics: (viewer, data): Topic[] =>
    viewer.role === 'taker'
      ? [idTopic('points', viewer.id)]
      : ['people', ...data.takers.map((t) => idTopic('points', t.id))],
})

export const getPointsFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }) => serveLive(pointsRead, context.user, undefined))
