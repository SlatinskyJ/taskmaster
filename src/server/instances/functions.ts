import { createServerFn } from '@tanstack/react-start'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import type { Db } from '~/server/db'
import { liveRead } from '~/server/live/define'
import { serveLive } from '~/server/live/read'
import type { TaskRow } from '~/server/db/schema'
import type { Result } from '~/domain/result'
import { getFlags } from '~/server/features'
import { parseTemplateId } from '~/server/templates/parse'
import type { InstanceError } from './instances'
import {
  createOnDemandInstance,
  listLoggableTemplates,
  logChoicesAt,
  selfLogInstance,
} from './instances'
import { parseSelfLog } from './parse'
import { getWeekPlan } from './weekPlan'
import type { WeekPlan } from './weekPlan'

export type { InstanceError }
export type { PlanCopy, PlanCopyStatus, PlanRow, WeekPlan } from './weekPlan'

// Server functions for instances made by a person (#38). Roles are checked here (guards) and
// again by the domain inside (`not_a_giver`, `not_a_taker`).

/** On success only the new row's id and score leave the server. */
export type InstanceActionResult =
  { ok: true; id: number; score: number } | { ok: false; error: InstanceError }

export const instanceResult = (r: Result<TaskRow, InstanceError>): InstanceActionResult =>
  r.ok ? { ok: true, id: r.value.id, score: r.value.score } : { ok: false, error: r.error }

/** "+ Teď": a giver makes an open instance of an agreed template now. */
export const createInstanceFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseTemplateId)
  .handler(({ data, context }): InstanceActionResult =>
    instanceResult(createOnDemandInstance(getDb(), context.user.id, data.templateId)),
  )

/** Zapsat: a taker logs a chore he did, at the score he was shown and the time he picked. */
export const selfLogFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('taker')])
  .validator(parseSelfLog)
  .handler(({ data, context }): InstanceActionResult =>
    instanceResult(
      selfLogInstance(getDb(), context.user.id, data.templateId, data.score, new Date(), data.when),
    ),
  )

/** Zapsat: a tile per agreed template, and the "Kdy?" times open now. */
export const loggableTemplatesRead = liveRead({
  read: (db, _viewer, _arg: undefined, now) => ({
    tiles: listLoggableTemplates(db, now),
    choices: logChoicesAt(db, now),
  }),
  // The tiles are agreed chores; a tile's state follows its copies (tasks).
  topics: () => ['templates', 'tasks'] as const,
})

export const listLoggableTemplatesFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('taker')])
  .handler(({ context }) => serveLive(loggableTemplatesRead, context.user, undefined))

/** The plan table on Týden (#258, spec §5.12), behind the `weekPlan` switch; no viewer: one board. */
export function weekPlanHandler(db: Db, now: Date): WeekPlan | { error: 'feature_off' } {
  return getFlags(db).weekPlan ? getWeekPlan(db, now) : { error: 'feature_off' }
}

/**
 * One board for everyone (#299): the week's days, its chores and their copies; switch off:
 * nothing read, nothing subscribed.
 */
export const weekPlanRead = liveRead({
  read: (db, _viewer, _arg: undefined, now) => weekPlanHandler(db, now),
  topics: (_viewer, data) => ('error' in data ? [] : (['week', 'templates', 'tasks'] as const)),
})

export const getWeekPlanFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }) => serveLive(weekPlanRead, context.user, undefined))
