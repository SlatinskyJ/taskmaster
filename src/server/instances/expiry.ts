import { and, inArray, lte } from 'drizzle-orm'
import { toIsoUtc } from '~/domain/dates'
import type { Db } from '~/server/db'
import { tasks } from '~/server/db/schema'
import { expireTask } from '~/server/tasks/lifecycle'

// The scheduler's expiry job (#39, spec §5.3): every open or reserved deadline instance whose
// grace window has ended expires. One transaction per instance, so one failure leaves the rest.

/** Expires what is overdue at `at`; returns the ids it expired. Never throws. */
export function expireOverdueInstances(
  db: Db,
  at: Date,
  log: Pick<Console, 'error'> = console,
): number[] {
  const due = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(inArray(tasks.status, ['open', 'reserved']), lte(tasks.graceEndsAt, toIsoUtc(at))))
    .orderBy(tasks.id)
    .all()
  const expired: number[] = []
  for (const { id } of due) {
    try {
      const r = expireTask(db, id, at)
      if (r.ok) expired.push(id)
      else log.error(`[scheduler] expiry: task ${String(id)} refused: ${r.error}`)
    } catch (err) {
      log.error(`[scheduler] expiry: task ${String(id)} failed`, err)
    }
  }
  return expired
}
