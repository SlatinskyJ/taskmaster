import { Cron } from 'croner'
import { APP_TIME_ZONE } from '~/domain/dates'

// The scheduler (#39, spec §5.3, §5.8): one tick every 15 minutes (Jakub 2026-11-22) runs every
// job, in order. The first tick runs at once when it starts, which is the catch-up after
// downtime: each job works from "what should exist at this instant", so one tick covers any
// number of missed ticks.
// A job that throws is logged; the other jobs still run, and the next tick tries it again.
// See README.md.

export interface Job {
  name: string
  /** Does the job's work for the instant `at`. Must be safe to run again for the same instant. */
  run(at: Date): void
}

/** :00, :15, :30, :45 Prague time (Jakub 2026-11-22: every minute is more than needed). */
export const TICK_PATTERN = '*/15 * * * *'

export interface SchedulerOptions {
  now?: () => Date
  log?: Pick<Console, 'info' | 'error'>
  /** Cron pattern of the tick, in Prague time. Default: every quarter hour (TICK_PATTERN). */
  pattern?: string
}

export function startScheduler(
  jobs: readonly Job[],
  opts: SchedulerOptions = {},
): { stop(): void } {
  const now = opts.now ?? (() => new Date())
  const log = opts.log ?? console
  const tick = () => {
    const at = now()
    for (const job of jobs) {
      try {
        job.run(at)
      } catch (err) {
        log.error(`[scheduler] ${job.name} failed`, err)
      }
    }
  }
  log.info(`[scheduler] started: ${jobs.map((j) => j.name).join(', ')}`)
  tick()
  // `protect`: a tick still running when the next one is due is not doubled.
  // `unref`: the timer never keeps the process alive on its own.
  const cron = new Cron(
    opts.pattern ?? TICK_PATTERN,
    { timezone: APP_TIME_ZONE, protect: true, unref: true },
    tick,
  )
  return {
    stop() {
      cron.stop()
    },
  }
}
