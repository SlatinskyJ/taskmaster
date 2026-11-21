import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFloat, currentFloat, showFloat, subscribeFloat } from './floatStore'

const effects = vi.hoisted(() => ({ enabled: true }))
vi.mock('~/lib/effects', () => ({ effectsEnabled: () => effects.enabled }))

const rect = { left: 10, top: 20, width: 30, height: 40 }

describe('floatStore (UI doc §4 "+N")', () => {
  beforeEach(() => {
    effects.enabled = true
    const f = currentFloat()
    if (f) clearFloat(f.key)
  })

  it('starts empty and gives each float a fresh key, so a second tap plays again', () => {
    expect(currentFloat()).toBeNull()
    showFloat({ points: 5, tone: 'pending', rect })
    const first = currentFloat()?.key ?? 0
    showFloat({ points: 3, tone: 'confirmed', rect })
    expect(currentFloat()).toEqual({ key: first + 1, points: 3, tone: 'confirmed', rect })
  })

  it('tells subscribers about each float until they unsubscribe', () => {
    const fn = vi.fn()
    const off = subscribeFloat(fn)
    showFloat({ points: 5, tone: 'pending', rect })
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    showFloat({ points: 5, tone: 'pending', rect })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('clears only the float it names, so a newer one is never dropped', () => {
    showFloat({ points: 5, tone: 'pending', rect })
    const old = currentFloat()?.key ?? 0
    showFloat({ points: 8, tone: 'pending', rect })
    clearFloat(old)
    expect(currentFloat()?.points).toBe(8)
    clearFloat(old + 1)
    expect(currentFloat()).toBeNull()
  })

  it('stores nothing with effects off, so no stale +N replays once they are back on', () => {
    effects.enabled = false
    showFloat({ points: 5, tone: 'pending', rect })
    expect(currentFloat()).toBeNull()
  })
})
