import type { PeriodDefaults } from '~/domain'
import type { Db } from '~/server/db'
import { createScheduledInstances, expireOverdueInstances } from '~/server/instances'
import { rollPeriods } from '~/server/periods'
import type { Job } from './scheduler'

// The jobs of a tick, in order (#39): periods first, so a cutoff that passed lands before
// anything else of that instant; then expiry; then new scheduled instances, so a slot born past
// its grace is made and expired by the instances job itself (./README.md).

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
          log.info(`[periods] started ${p.startsAt.toISOString()} → ${p.cutoffAt.toISOString()}`)
        }
      },
    },
    {
      name: 'expiry',
      run(at) {
        const n = expireOverdueInstances(db, at, log).length
        if (n > 0) log.info(`[scheduler] expiry: ${String(n)}`)
      },
    },
    {
      name: 'instances',
      run(at) {
        const n = createScheduledInstances(db, at, log).length
        if (n > 0) log.info(`[scheduler] instances: ${String(n)}`)
      },
    },
  ]
}
