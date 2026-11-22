import { periodEnd } from '~/domain'
import type { Db } from '~/server/db'
import { getPeriodDefaults } from './defaults'
import { currentPeriod, rollPeriods } from './periods'

// The period roller (spec §5.8): rolls periods over at the cutoff and catches up after
// downtime. The scheduler (#39) is deferred for launch, so this is its own small loop; #39's job
// framework takes it over later. Started by the boot plugin (src/server/plugins/database.ts).
//
// The first tick runs at once (boot catch-up). Each tick rolls, then sleeps until the running
// period's end, at most `maxDelayMs` (so a sleeping laptop or clock change can't push a roll far
// back). Each tick reads the stored default week (./defaults.ts). A failed tick is logged and retried after `retryDelayMs`; it never throws.

export interface RollerOptions {
  now?: () => Date
  maxDelayMs?: number
  retryDelayMs?: number
  log?: Pick<Console, 'info' | 'error'>
}

export function startPeriodRoller(db: Db, opts: RollerOptions = {}): { stop(): void } {
  const now = opts.now ?? (() => new Date())
  const maxDelayMs = opts.maxDelayMs ?? 3_600_000
  const retryDelayMs = opts.retryDelayMs ?? 60_000
  const log = opts.log ?? console
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let announced: string | undefined

  const schedule = (ms: number) => {
    if (stopped) return
    timer = setTimeout(tick, ms)
    timer.unref()
  }

  function tick() {
    try {
      const at = now()
      // The defaults stored now (an admin may have changed them since the last tick).
      for (const p of rollPeriods(db, at, getPeriodDefaults(db))) {
        const levels = `${String(p.levels.lower)}/${String(p.levels.upper)}`
        log.info(
          `[periods] started ${p.startsAt.toISOString()} → ${p.cutoffAt.toISOString()} levels ${levels}`,
        )
      }
      const running = currentPeriod(db, at)
      if (!running) {
        // Unreachable after a roll; never spin on it.
        schedule(retryDelayMs)
        return
      }
      const end = periodEnd(running)
      const endIso = end.toISOString()
      if (endIso !== announced) {
        log.info(`[periods] running period ends ${endIso}`)
        announced = endIso
      }
      schedule(Math.min(Math.max(end.getTime() - now().getTime(), 0), maxDelayMs))
    } catch (err) {
      log.error('[periods] roll failed', err)
      schedule(retryDelayMs)
    }
  }

  tick()
  return {
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
