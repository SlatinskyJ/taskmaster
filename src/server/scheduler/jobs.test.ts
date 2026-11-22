import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import { fromPragueWallTime } from '~/domain/dates'
import { createTestDb } from '~/server/db/testing'
import { createOnDemandInstance } from '~/server/instances'
import { listPeriods, rollPeriods } from '~/server/periods'
import { T0, T1, family, must, row } from '~/server/tasks/testing'
import { approveTemplateScore, createTemplate } from '~/server/templates'
import { schedulerJobs } from './jobs'
import { startScheduler } from './scheduler'

// The real jobs over a test DB (#39).

const prague = (month: number, day: number, hour: number, minute = 0) =>
  fromPragueWallTime({ year: 2026, month, day, hour, minute })
const D = () => DEFAULT_PERIOD_DEFAULTS
const quietLog = () => ({ info: vi.fn(), error: vi.fn() })

afterEach(() => {
  vi.useRealTimers()
})

describe('schedulerJobs', () => {
  it('in one tick: makes the first period, expires what is overdue, makes what is due', () => {
    const f = family()
    const bins = must(
      createTemplate(
        f.db,
        f.tata,
        {
          title: 'Vynést koše',
          score: 4,
          approvalRequired: true,
          schedule: null,
          deadline: { dayOffset: 1, due: { hour: 7, minute: 30 }, graceMinutes: 60 },
        },
        T0,
      ),
    ).id
    must(approveTemplateScore(f.db, f.starsi, bins, 4, T0))
    const overdue = must(createOnDemandInstance(f.db, f.tata, bins, T1)).id
    const weekly = must(
      createTemplate(
        f.db,
        f.tata,
        {
          title: 'Zamést chodbu',
          score: 3,
          approvalRequired: true,
          schedule: { days: [2], time: { hour: 18, minute: 0 } },
          deadline: null,
        },
        T0,
      ),
    ).id
    must(approveTemplateScore(f.db, f.starsi, weekly, 3, prague(11, 23, 10)))

    const log = quietLog()
    const at = prague(11, 24, 18)
    for (const job of schedulerJobs(f.db, D, log)) job.run(at)

    expect(log.info.mock.calls.map((c) => c[0] as string)).toEqual([
      `[periods] started ${at.toISOString()} → 2026-11-29T22:59:00.000Z levels 50/100`,
      '[scheduler] expiry: 1',
      '[scheduler] instances: 1',
    ])
    expect(listPeriods(f.db)).toHaveLength(1)
    expect(row(f.db, overdue)?.status).toBe('expired')
    expect(log.error).not.toHaveBeenCalled()
  })

  it('reads the period defaults on every tick, so a stored change applies (#186)', () => {
    const db = createTestDb()
    let defaults = DEFAULT_PERIOD_DEFAULTS
    const jobs = schedulerJobs(db, () => defaults, quietLog())
    const periods = jobs.find((j) => j.name === 'periods')
    periods?.run(prague(11, 16, 10))
    defaults = { ...DEFAULT_PERIOD_DEFAULTS, levels: { lower: 60, upper: 120 } }
    periods?.run(prague(11, 23, 0, 30))
    expect(listPeriods(db).map((p) => [p.levels.lower, p.levels.upper])).toEqual([
      [50, 100],
      [60, 120],
    ])
  })

  // Sunday 23:59 is between quarter-hour ticks: the 00:00 tick starts the next period, from the
  // cutoff (so nothing done in that minute falls between periods).
  it('rolls the period at the first tick after the cutoff while running', async () => {
    const db = createTestDb()
    rollPeriods(db, prague(11, 16, 10), DEFAULT_PERIOD_DEFAULTS)
    const [first] = listPeriods(db)
    expect(first?.cutoffAt).toEqual(prague(11, 22, 23, 59))
    vi.useFakeTimers()
    vi.setSystemTime(prague(11, 22, 23, 58))
    const log = quietLog()
    const s = startScheduler(schedulerJobs(db, D, log), { log })
    expect(listPeriods(db)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    const [, second, ...more] = listPeriods(db)
    expect(more).toEqual([])
    expect(second?.startsAt).toEqual(first?.cutoffAt)
    s.stop()
  })
})
