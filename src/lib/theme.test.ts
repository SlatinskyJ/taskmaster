import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_STORAGE_KEY, applyThemePref, parseThemePref, themeBootScript } from './theme'

// Node test env: stub the two browser globals theme.ts touches.
let dataset: Record<string, string | undefined>
let store: Map<string, string>

function fakeStorage(throws = false) {
  const fail = () => {
    throw new Error('SecurityError: storage blocked')
  }
  return {
    getItem: throws ? fail : (k: string) => store.get(k) ?? null,
    setItem: throws ? fail : (k: string, v: string) => store.set(k, v),
    removeItem: throws ? fail : (k: string) => store.delete(k),
  }
}

beforeEach(() => {
  dataset = {}
  store = new Map()
  vi.stubGlobal('document', { documentElement: { dataset } })
  vi.stubGlobal('localStorage', fakeStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const runBootScript = () => {
  // The script is shipped as a string into <head>; run it the same way the browser would.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  ;(new Function(themeBootScript) as () => void)()
}

describe('parseThemePref', () => {
  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    ['auto', 'auto'],
    [null, 'auto'],
    ['purple', 'auto'],
  ] as const)('%s → %s', (input, expected) => {
    expect(parseThemePref(input)).toBe(expected)
  })
})

describe('applyThemePref', () => {
  it('forces dark: sets data-theme and remembers it', () => {
    applyThemePref('dark')
    expect(dataset.theme).toBe('dark')
    expect(store.get(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('forces light the same way', () => {
    applyThemePref('light')
    expect(dataset.theme).toBe('light')
    expect(store.get(THEME_STORAGE_KEY)).toBe('light')
  })

  it('auto: removes the attribute and the stored choice, so the system decides', () => {
    applyThemePref('dark')
    applyThemePref('auto')
    expect(dataset.theme).toBeUndefined()
    expect(store.has(THEME_STORAGE_KEY)).toBe(false)
  })

  it('still applies the theme when storage is blocked', () => {
    vi.stubGlobal('localStorage', fakeStorage(true))
    expect(() => {
      applyThemePref('dark')
    }).not.toThrow()
    expect(dataset.theme).toBe('dark')
  })
})

describe('themeBootScript', () => {
  it.each(['light', 'dark'])('applies a stored %s before paint', (stored) => {
    store.set(THEME_STORAGE_KEY, stored)
    runBootScript()
    expect(dataset.theme).toBe(stored)
  })

  it.each([undefined, 'auto', 'purple'])('leaves the system in charge for %s', (stored) => {
    if (stored) store.set(THEME_STORAGE_KEY, stored)
    runBootScript()
    expect(dataset.theme).toBeUndefined()
  })

  it('does not throw when storage is blocked', () => {
    vi.stubGlobal('localStorage', fakeStorage(true))
    expect(runBootScript).not.toThrow()
    expect(dataset.theme).toBeUndefined()
  })

  it('agrees with applyThemePref on the storage key', () => {
    expect(themeBootScript).toContain(`'${THEME_STORAGE_KEY}'`)
  })
})
