import { and, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm'
import { startOfPragueDay, toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { tasks } from '~/server/db/schema'
import { expireTask } from '~/server/tasks/lifecycle'

// The scheduler's expiry job (#39, spec §5.3): every open or reserved deadline instance whose
// grace window has ended expires. With the `weekPlan` switch on (#257, spec §5.12) so does every
// open or reserved no-deadline week copy whose day is over (its rules still on). One transaction
// per instance, so one failure leaves the rest.

/** Expires what is overdue at `at`; returns the ids it expired. Never throws. */
export function expireOverdueInstances(
  db: Db | Tx,
  at: Date,
  log: Pick<Console, 'error'> = console,
  weekPlan = false,
): number[] {
  const graceOver = lte(tasks.graceEndsAt, toIsoUtc(at))
  const dayOver = and(
    eq(tasks.weekRules, true),
    isNull(tasks.dueAt),
    lt(tasks.planDayAt, toIsoUtc(startOfPragueDay(at))),
  )
  const due = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        inArray(tasks.status, ['open', 'reserved']),
        weekPlan ? or(graceOver, dayOver) : graceOver,
      ),
    )
    .orderBy(tasks.id)
    .all()
  const expired: number[] = []
  for (const { id } of due) {
    try {
      const r = expireTask(db, id, at, weekPlan)
      if (r.ok) expired.push(id)
      else log.error(`[scheduler] expiry: task ${String(id)} refused: ${r.error}`)
    } catch (err) {
      log.error(`[scheduler] expiry: task ${String(id)} failed`, err)
    }
  }
  return expired
}
