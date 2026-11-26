import { eq } from 'drizzle-orm'
import { toIsoUtc } from '~/domain/dates'
import { writeAudit } from '~/server/audit'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { tasks } from '~/server/db/schema'

// The `weekPlan` switch turned off drops the day rules for good (#257, spec §5.12 "copies made
// before the flip keep the old rules"): the scheduler's `weekRules` job turns `week_rules` off
// on every task that has it, whatever its status (a done copy a giver rejects later comes back
// under the old rules). `plan_day_at` stays, so the copy keeps its day for display. The drop
// needs one tick (15 min) with the switch off: on → off → on inside one tick leaves the rules on
// the earlier copies. One transaction per task, with its audit entry
// (`instance.week_rules_dropped`, actor system).

/** Drops the day rules of every marked task; returns the ids it dropped. Never throws. */
export function dropWeekRules(
  db: Db | Tx,
  at: Date,
  log: Pick<Console, 'error'> = console,
): number[] {
  const marked = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.weekRules, true))
    .orderBy(tasks.id)
    .all()
  const dropped: number[] = []
  for (const { id } of marked) {
    try {
      db.transaction((tx) => {
        tx.update(tasks)
          .set({ weekRules: false, updatedAt: toIsoUtc(at) })
          .where(eq(tasks.id, id))
          .run()
        writeAudit(tx, {
          actor: { kind: 'system' },
          action: 'instance.week_rules_dropped',
          entityType: 'task',
          entityId: id,
          before: { weekRules: true },
          after: { weekRules: false },
          at,
        })
      })
      dropped.push(id)
    } catch (err) {
      log.error(`[scheduler] week rules: task ${String(id)} failed`, err)
    }
  }
  return dropped
}
