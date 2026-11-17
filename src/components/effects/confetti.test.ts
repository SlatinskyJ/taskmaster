import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setEffectsSwitch } from '~/lib/effects'
import { burstConfetti } from './confetti'

const confettiMock = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('canvas-confetti', () => ({ default: confettiMock }))

let reducedMotion: boolean

beforeEach(() => {
  confettiMock.mockClear()
  reducedMotion = false
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  })
  vi.stubGlobal('window', {
    innerWidth: 390,
    innerHeight: 844,
    matchMedia: () => ({
      matches: reducedMotion,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  })
  vi.stubGlobal('document', { documentElement: {} })
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#36a853' }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('burstConfetti', () => {
  it('bursts once with the Efekty switch on', () => {
    burstConfetti()
    expect(confettiMock).toHaveBeenCalledTimes(1)
  })

  it('does nothing with the Efekty switch off', () => {
    setEffectsSwitch(false)
    burstConfetti()
    expect(confettiMock).not.toHaveBeenCalled()
  })

  it('does nothing when the system asks for reduced motion', () => {
    reducedMotion = true
    burstConfetti()
    expect(confettiMock).not.toHaveBeenCalled()
  })

  it('starts from the middle of the given element', () => {
    const el = { getBoundingClientRect: () => ({ left: 290, top: 400, width: 80, height: 44 }) }
    burstConfetti(el as unknown as Element)
    expect(confettiMock).toHaveBeenCalledWith(
      expect.objectContaining({ origin: { x: 330 / 390, y: 422 / 844 } }),
    )
  })
})
