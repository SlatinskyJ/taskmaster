import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EFFECTS_STORAGE_KEY, effectsEnabled, setEffectsSwitch, subscribeEffects } from './effects'

// Node test env: stub localStorage and the reduced-motion media query.
let store: Map<string, string>
let reducedMotion: boolean
let mediaListeners: Set<() => void>

function stubStorage(throws = false) {
  const fail = () => {
    throw new Error('SecurityError: storage blocked')
  }
  vi.stubGlobal('localStorage', {
    getItem: throws ? fail : (k: string) => store.get(k) ?? null,
    setItem: throws ? fail : (k: string, v: string) => store.set(k, v),
    removeItem: throws ? fail : (k: string) => store.delete(k),
  })
}

beforeEach(() => {
  store = new Map()
  reducedMotion = false
  mediaListeners = new Set()
  stubStorage()
  vi.stubGlobal('window', {
    matchMedia: (q: string) => ({
      matches: q === '(prefers-reduced-motion: reduce)' && reducedMotion,
      addEventListener: (_: string, l: () => void) => mediaListeners.add(l),
      removeEventListener: (_: string, l: () => void) => mediaListeners.delete(l),
    }),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('effects switch', () => {
  it('is on by default', () => {
    expect(effectsEnabled()).toBe(true)
  })

  it('turns off and is remembered on the device', () => {
    setEffectsSwitch(false)
    expect(store.get(EFFECTS_STORAGE_KEY)).toBe('off')
    expect(effectsEnabled()).toBe(false)
  })

  it('turns back on by forgetting the choice', () => {
    setEffectsSwitch(false)
    setEffectsSwitch(true)
    expect(store.has(EFFECTS_STORAGE_KEY)).toBe(false)
    expect(effectsEnabled()).toBe(true)
  })

  it('stays off when the system asks for reduced motion, even with the switch on', () => {
    reducedMotion = true
    expect(effectsEnabled()).toBe(false)
  })

  it('counts as on when storage is blocked, and switching does not throw', () => {
    stubStorage(true)
    expect(effectsEnabled()).toBe(true)
    expect(() => {
      setEffectsSwitch(false)
    }).not.toThrow()
  })
})

describe('subscribeEffects', () => {
  it('notifies on a switch change and on a reduced-motion change, until unsubscribed', () => {
    const listener = vi.fn()
    const off = subscribeEffects(listener)
    setEffectsSwitch(false)
    reducedMotion = true
    for (const l of mediaListeners) l()
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    setEffectsSwitch(true)
    expect(mediaListeners.size).toBe(0)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
