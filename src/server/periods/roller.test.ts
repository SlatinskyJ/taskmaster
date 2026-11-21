import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import { fromPragueWallTime } from '~/domain/dates'
import { createTestDb } from '~/server/db/testing'
import { failAuditOn } from '~/server/tasks/testing'
import { listPeriods } from './periods'
import { startPeriodRoller } from './roller'

const D = DEFAULT_PERIOD_DEFAULTS
const SAT = fromPragueWallTime({ year: 2026, month: 11, day: 21, hour: 20, minute: 0 })
const CUTOFF = fromPragueWallTime({ year: 2026, month: 11, day: 29, hour: 23, minute: 59 })
const HOUR = 3_600_000

const quietLog = () => ({ info: vi.fn(), error: vi.fn() })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(SAT)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('startPeriodRoller', () => {
  it('rolls once at start and logs the running period end', () => {
    const db = createTestDb()
    const log = quietLog()
    const roller = startPeriodRoller(db, D, { log })
    expect(listPeriods(db)).toHaveLength(1)
    expect(log.info).toHaveBeenCalledWith(`[periods] running period ends ${CUTOFF.toISOString()}`)
    roller.stop()
  })

  it('rolls at the cutoff', () => {
    const db = createTestDb()
    const roller = startPeriodRoller(db, D, { log: quietLog() })
    vi.advanceTimersByTime(CUTOFF.getTime() - SAT.getTime())
    const [first, second] = listPeriods(db)
    expect(second?.startsAt).toEqual(first?.cutoffAt)
    roller.stop()
  })

  it('wakes at most every maxDelayMs and creates nothing early', () => {
    const db = createTestDb()
    const log = quietLog()
    const roller = startPeriodRoller(db, D, { log, maxDelayMs: HOUR })
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(HOUR)
    expect(listPeriods(db)).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(1)
    roller.stop()
  })

  it('an early wake rolls at the next wake', () => {
    const db = createTestDb()
    // The clock runs 5 ms behind the timer: the wake lands just before the cutoff.
    let skew = 0
    const roller = startPeriodRoller(db, D, {
      log: quietLog(),
      now: () => new Date(Date.now() - skew),
    })
    skew = 5
    vi.advanceTimersByTime(CUTOFF.getTime() - SAT.getTime())
    expect(listPeriods(db)).toHaveLength(1)
    skew = 0
    vi.advanceTimersByTime(5)
    expect(listPeriods(db)).toHaveLength(2)
    roller.stop()
  })

  it('a failed boot roll is logged, does not throw, and is retried', () => {
    const db = createTestDb()
    failAuditOn(db, 'period.created')
    const log = quietLog()
    const roller = startPeriodRoller(db, D, { log, retryDelayMs: 60_000 })
    expect(log.error).toHaveBeenCalledWith('[periods] roll failed', expect.any(Error))
    expect(listPeriods(db)).toHaveLength(0)
    db.$client.exec('DROP TRIGGER fail_period_created')
    vi.advanceTimersByTime(60_000)
    expect(listPeriods(db)).toHaveLength(1)
    roller.stop()
  })

  it('keeps running after a later failed roll', () => {
    const db = createTestDb()
    const log = quietLog()
    const roller = startPeriodRoller(db, D, { log, retryDelayMs: 60_000 })
    failAuditOn(db, 'period.created')
    vi.advanceTimersByTime(CUTOFF.getTime() - SAT.getTime())
    expect(log.error).toHaveBeenCalledTimes(1)
    db.$client.exec('DROP TRIGGER fail_period_created')
    vi.advanceTimersByTime(60_000)
    expect(listPeriods(db)).toHaveLength(2)
    roller.stop()
  })

  it('logs each started period, and the running end once per change', () => {
    const db = createTestDb()
    const log = quietLog()
    const roller = startPeriodRoller(db, D, { log })
    vi.advanceTimersByTime(CUTOFF.getTime() - SAT.getTime())
    const lines = log.info.mock.calls.map((c) => String(c[0]))
    const [first, second] = listPeriods(db)
    expect(lines).toEqual([
      `[periods] started ${SAT.toISOString()} → ${CUTOFF.toISOString()}`,
      `[periods] running period ends ${CUTOFF.toISOString()}`,
      `[periods] started ${CUTOFF.toISOString()} → ${second?.cutoffAt.toISOString()}`,
      `[periods] running period ends ${second?.cutoffAt.toISOString()}`,
    ])
    expect(first?.cutoffAt).toEqual(CUTOFF)
    roller.stop()
  })

  it('after stop() nothing rolls, even across a cutoff', () => {
    const db = createTestDb()
    const roller = startPeriodRoller(db, D, { log: quietLog() })
    roller.stop()
    vi.advanceTimersByTime(CUTOFF.getTime() - SAT.getTime() + HOUR)
    expect(listPeriods(db)).toHaveLength(1)
  })

  it('retries a failed roll after one minute by default', () => {
    const db = createTestDb()
    failAuditOn(db, 'period.created')
    const log = quietLog()
    const roller = startPeriodRoller(db, D, { log })
    expect(log.error).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(59_999)
    expect(log.error).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(log.error).toHaveBeenCalledTimes(2)
    roller.stop()
  })

  it('stop() clears the timer', () => {
    const db = createTestDb()
    const roller = startPeriodRoller(db, D, { log: quietLog() })
    roller.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
