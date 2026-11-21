import { createServerFn } from '@tanstack/react-start'
import type { Role } from '~/domain/parties'
import type { Tx } from '~/server/audit'
import { requireRole } from '~/server/auth/guards'
import type { Db } from '~/server/db'
import { getDb } from '~/server/db'
import type { PointsOverview, TakerPoints } from './points'
import { takerPoints } from './points'

export type { PointsOverview, TakerPoints }

// Points for Domů (#40, spec §5.7): a taker sees his own points, a giver every taker's.

/** The handler's whole body, so its filter is tested on a real database. */
export function pointsView(db: Db | Tx, viewer: { id: number; role: Role }): PointsOverview {
  const overview = takerPoints(db)
  if (viewer.role !== 'taker') return overview
  return { ...overview, takers: overview.takers.filter((t) => t.id === viewer.id) }
}

export const getPointsFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }): PointsOverview => pointsView(getDb(), context.user))
