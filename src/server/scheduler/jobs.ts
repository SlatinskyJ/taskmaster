import type { PeriodDefaults } from '~/domain'
import type { Db } from '~/server/db'
import { getFlags } from '~/server/features'
import {
  createScheduledInstances,
  expireOverdueInstances,
  dropWeekRules,
  makeWeekCopies,
} from '~/server/instances'
import { rollPeriods } from '~/server/periods'
import type { Job } from './scheduler'

// The jobs of a tick, in order (#39): periods first, so a cutoff that passed lands before
// anything else of that instant; then the week rules (#257); then expiry; then new scheduled instances, so a slot born past
// its grace is made and expired by the instances job itself (./README.md). With the `weekPlan`
// switch on (#257) the instances job makes the week's copies instead.

/** `defaults` is read on every tick, so a change of the family's period settings applies. */
export function schedulerJobs(
  db: Db,
  defaults: () => PeriodDefaults,
  log: Pick<Console, 'info' | 'error'> = console,
): Job[] {
  return [
    {
      name: 'periods',
      run(at) {
        for (const p of rollPeriods(db, at, defaults())) {
          const levels = `${String(p.levels.lower)}/${String(p.levels.upper)}`
          log.info(
            `[periods] started ${p.startsAt.toISOString()} → ${p.cutoffAt.toISOString()} levels ${levels}`,
          )
        }
      },
    },
    {
      // With the week plan off, week copies lose their day rules for good (#257).
      name: 'weekRules',
      run(at) {
        if (getFlags(db).weekPlan) return
        const n = dropWeekRules(db, at, log).length
        if (n > 0) log.info(`[scheduler] week rules dropped: ${String(n)}`)
      },
    },
    {
      name: 'expiry',
      run(at) {
        const n = expireOverdueInstances(db, at, log, getFlags(db).weekPlan).length
        if (n > 0) log.info(`[scheduler] expiry: ${String(n)}`)
      },
    },
    {
      name: 'instances',
      run(at) {
        const made = getFlags(db).weekPlan
          ? makeWeekCopies(db, at, { log })
          : createScheduledInstances(db, at, log)
        const n = made.length
        if (n > 0) log.info(`[scheduler] instances: ${String(n)}`)
      },
    },
  ]
}
