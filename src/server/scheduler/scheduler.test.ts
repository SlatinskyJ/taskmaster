import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from './scheduler'
import { startScheduler } from './scheduler'

// The tick (#39): every job once at start (boot catch-up), then once a minute, each with the
// instant of its tick; a failing job never stops the others. croner schedules its next run
// after a microtask, so the clock moves with `advanceTimersByTimeAsync`.

const START = new Date('2026-11-22T10:00:30.000Z')
const quietLog = () => ({ info: vi.fn(), error: vi.fn() })

function recorder(name: string, order: string[], fail = false) {
  const seen: Date[] = []
  const job: Job = {
    name,
    run(at) {
      order.push(name)
      seen.push(at)
      if (fail) throw new Error('boom')
    },
  }
  return { job, seen }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('startScheduler', () => {
  it('logs its jobs and runs each once at once, in order, with now()', () => {
    const order: string[] = []
    const a = recorder('periods', order)
    const b = recorder('expiry', order)
    const c = recorder('instances', order)
    const log = quietLog()
    const s = startScheduler([a.job, b.job, c.job], { log })
    expect(log.info).toHaveBeenCalledWith('[scheduler] started: periods, expiry, instances')
    expect(order).toEqual(['periods', 'expiry', 'instances'])
    expect(a.seen).toEqual([START])
    s.stop()
  })

  it('runs again at the next minute, with that tick’s instant', async () => {
    const order: string[] = []
    const a = recorder('periods', order)
    const s = startScheduler([a.job], { log: quietLog(), now: () => new Date() })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(a.seen.map((d) => d.toISOString())).toEqual([
      '2026-11-22T10:00:30.000Z',
      '2026-11-22T10:01:00.000Z',
    ])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(a.seen).toHaveLength(3)
    s.stop()
  })

  it('a failing job is logged, the next one still runs, and it runs again next tick', async () => {
    const order: string[] = []
    const bad = recorder('expiry', order, true)
    const good = recorder('instances', order)
    const log = quietLog()
    const s = startScheduler([bad.job, good.job], { log })
    expect(order).toEqual(['expiry', 'instances'])
    expect(log.error).toHaveBeenCalledWith('[scheduler] expiry failed', expect.any(Error))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(order).toEqual(['expiry', 'instances', 'expiry', 'instances'])
    s.stop()
  })

  it('stop() ends it: no timer left, no more runs', async () => {
    const order: string[] = []
    const a = recorder('periods', order)
    const s = startScheduler([a.job], { log: quietLog() })
    s.stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(order).toEqual(['periods'])
  })
})
