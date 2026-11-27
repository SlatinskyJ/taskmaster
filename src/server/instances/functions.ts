import { createServerFn } from '@tanstack/react-start'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import type { Db } from '~/server/db'
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
export const listLoggableTemplatesFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('taker')])
  .handler(() => {
    const db = getDb()
    const now = new Date()
    return { tiles: listLoggableTemplates(db, now), choices: logChoicesAt(db, now) }
  })

/** What `getWeekPlanFn` answers: the plan, or `feature_off` while the `weekPlan` switch is off. */
export type PlanAnswer = WeekPlan | { error: 'feature_off' }

/** The plan table on Týden (#258, spec §5.12), behind the `weekPlan` switch; no viewer: one board. */
export function weekPlanHandler(db: Db, now: Date): PlanAnswer {
  return getFlags(db).weekPlan ? getWeekPlan(db, now) : { error: 'feature_off' }
}

export const getWeekPlanFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(() => weekPlanHandler(getDb(), new Date()))
