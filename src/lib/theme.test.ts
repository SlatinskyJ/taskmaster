import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  THEME_COLORS,
  THEME_STORAGE_KEY,
  applyThemePref,
  parseThemePref,
  themeBootScript,
  themeColorFor,
} from './theme'

// Node test env: stub the two browser globals theme.ts touches.
let dataset: Record<string, string | undefined>
let store: Map<string, string>
let metas: { media: string; content: string }[]
const LIGHT_MEDIA = '(prefers-color-scheme: light)'
const DARK_MEDIA = '(prefers-color-scheme: dark)'
const colors = () => metas.map((meta) => meta.content)

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
  metas = [
    { media: LIGHT_MEDIA, content: THEME_COLORS.light },
    { media: DARK_MEDIA, content: THEME_COLORS.dark },
  ]
  vi.stubGlobal('document', {
    documentElement: { dataset },
    querySelectorAll: (selector: string) => (selector === 'meta[name="theme-color"]' ? metas : []),
  })
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

describe('themeColorFor', () => {
  it.each([
    ['light', LIGHT_MEDIA, '#FFF5EE'],
    ['light', DARK_MEDIA, '#FFF5EE'],
    ['dark', LIGHT_MEDIA, '#1D1524'],
    ['dark', DARK_MEDIA, '#1D1524'],
    ['auto', LIGHT_MEDIA, '#FFF5EE'],
    ['auto', DARK_MEDIA, '#1D1524'],
  ] as const)('%s on the %s meta is %s', (pref, media, color) => {
    expect(themeColorFor(pref, media)).toBe(color)
  })
})

describe('applyThemePref', () => {
  it('forces dark: sets data-theme and remembers it', () => {
    applyThemePref('dark')
    expect(dataset.theme).toBe('dark')
    expect(store.get(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('forces dark: both theme-color metas take the dark page colour', () => {
    applyThemePref('dark')
    expect(colors()).toEqual(['#1D1524', '#1D1524'])
  })

  it('forces light the same way', () => {
    applyThemePref('dark')
    applyThemePref('light')
    expect(dataset.theme).toBe('light')
    expect(store.get(THEME_STORAGE_KEY)).toBe('light')
    expect(colors()).toEqual(['#FFF5EE', '#FFF5EE'])
  })

  it('auto: removes the attribute and the stored choice, so the system decides', () => {
    applyThemePref('dark')
    applyThemePref('auto')
    expect(dataset.theme).toBeUndefined()
    expect(store.has(THEME_STORAGE_KEY)).toBe(false)
  })

  it('back to auto, each meta follows its own colour scheme again', () => {
    applyThemePref('dark')
    applyThemePref('auto')
    expect(colors()).toEqual(['#FFF5EE', '#1D1524'])
  })

  it('still applies the theme when storage is blocked', () => {
    vi.stubGlobal('localStorage', fakeStorage(true))
    expect(() => {
      applyThemePref('dark')
    }).not.toThrow()
    expect(dataset.theme).toBe('dark')
    expect(colors()).toEqual(['#1D1524', '#1D1524'])
  })
})

describe('themeBootScript', () => {
  it.each(['light', 'dark'] as const)('applies a stored %s before paint', (stored) => {
    store.set(THEME_STORAGE_KEY, stored)
    runBootScript()
    expect(dataset.theme).toBe(stored)
    expect(colors()).toEqual([THEME_COLORS[stored], THEME_COLORS[stored]])
  })

  it.each([undefined, 'auto', 'purple'])('leaves the system in charge for %s', (stored) => {
    if (stored) store.set(THEME_STORAGE_KEY, stored)
    for (const meta of metas) meta.content = '#000000'
    runBootScript()
    expect(dataset.theme).toBeUndefined()
    expect(colors()).toEqual(['#FFF5EE', '#1D1524'])
  })

  it.each([undefined, 'light', 'dark', 'auto', 'purple'])(
    'agrees with themeColorFor for a stored %s',
    (stored) => {
      if (stored) store.set(THEME_STORAGE_KEY, stored)
      for (const meta of metas) meta.content = '#000000'
      runBootScript()
      for (const meta of metas) {
        expect(meta.content).toBe(themeColorFor(parseThemePref(stored ?? null), meta.media))
      }
    },
  )

  it('does not throw when storage is blocked', () => {
    vi.stubGlobal('localStorage', fakeStorage(true))
    expect(runBootScript).not.toThrow()
    expect(dataset.theme).toBeUndefined()
    expect(colors()).toEqual(['#FFF5EE', '#1D1524'])
  })

  it('agrees with applyThemePref on the storage key', () => {
    expect(themeBootScript).toContain(`'${THEME_STORAGE_KEY}'`)
  })
})
