import { createServerFn } from '@tanstack/react-start'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import type { PointsOverview, TakerPoints } from './points'
import { pointsView } from './points'

export type { PointsOverview, TakerPoints }

// Points for Domů (#40, spec §5.7). The handler is exactly `pointsView` (tested in points).

export const getPointsFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }): PointsOverview => pointsView(getDb(), context.user))
