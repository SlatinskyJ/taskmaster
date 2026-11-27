import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FORCED_META_ATTR,
  THEME_COLORS,
  THEME_STORAGE_KEY,
  applyThemePref,
  forcedThemeColor,
  parseThemePref,
  themeBootScript,
} from './theme'

// Node test env: stub the browser globals theme.ts touches, with a <head> that holds the
// page's two theme-color metas (light, dark), as the root route renders them.
let dataset: Record<string, string | undefined>
let store: Map<string, string>

class FakeMeta {
  name = ''
  content = ''
  attrs = new Map<string, string>()
  constructor(readonly head: FakeHead) {}
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value)
  }
  remove() {
    this.head.children = this.head.children.filter((child) => child !== this)
  }
}

class FakeHead {
  children: FakeMeta[] = []
  prepend(meta: FakeMeta) {
    this.children.unshift(meta)
  }
}

let head: FakeHead
const LIGHT = THEME_COLORS.light
const DARK = THEME_COLORS.dark
/** Theme-color contents in <head> order; the browser uses the first that matches. */
const colors = () => head.children.map((meta) => meta.content)

function pageMeta(content: string): FakeMeta {
  const meta = new FakeMeta(head)
  meta.name = 'theme-color'
  meta.content = content
  return meta
}

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
  head = new FakeHead()
  head.children = [pageMeta(LIGHT), pageMeta(DARK)]
  vi.stubGlobal('document', {
    documentElement: { dataset },
    head,
    createElement: (tag: string) => {
      expect(tag).toBe('meta')
      return new FakeMeta(head)
    },
    querySelector: (selector: string) => {
      expect(selector).toBe(`meta[${FORCED_META_ATTR}]`)
      return head.children.find((meta) => meta.attrs.has(FORCED_META_ATTR)) ?? null
    },
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

describe('forcedThemeColor', () => {
  it.each([
    ['light', '#FFF5EE'],
    ['dark', '#1D1524'],
    ['auto', undefined],
  ] as const)('%s forces %s', (pref, color) => {
    expect(forcedThemeColor(pref)).toBe(color)
  })
})

describe('applyThemePref', () => {
  it('forces dark: sets data-theme and remembers it', () => {
    applyThemePref('dark')
    expect(dataset.theme).toBe('dark')
    expect(store.get(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('forces dark: a dark theme-color goes first, the page’s two stay as they are', () => {
    applyThemePref('dark')
    expect(colors()).toEqual([DARK, LIGHT, DARK])
    expect(head.children[0]?.name).toBe('theme-color')
  })

  it('forces light the same way, reusing the forced meta', () => {
    applyThemePref('dark')
    applyThemePref('light')
    expect(dataset.theme).toBe('light')
    expect(store.get(THEME_STORAGE_KEY)).toBe('light')
    expect(colors()).toEqual([LIGHT, LIGHT, DARK])
  })

  it('auto: removes the attribute and the stored choice, so the system decides', () => {
    applyThemePref('dark')
    applyThemePref('auto')
    expect(dataset.theme).toBeUndefined()
    expect(store.has(THEME_STORAGE_KEY)).toBe(false)
  })

  it('back to auto, the forced theme-color goes and the page’s two decide again', () => {
    applyThemePref('dark')
    applyThemePref('auto')
    expect(colors()).toEqual([LIGHT, DARK])
    applyThemePref('auto')
    expect(colors()).toEqual([LIGHT, DARK])
  })

  it('still applies the theme when storage is blocked', () => {
    vi.stubGlobal('localStorage', fakeStorage(true))
    expect(() => {
      applyThemePref('dark')
    }).not.toThrow()
    expect(dataset.theme).toBe('dark')
    expect(colors()).toEqual([DARK, LIGHT, DARK])
  })
})

describe('themeBootScript', () => {
  it.each(['light', 'dark'] as const)('applies a stored %s before paint', (stored) => {
    store.set(THEME_STORAGE_KEY, stored)
    runBootScript()
    expect(dataset.theme).toBe(stored)
    expect(colors()).toEqual([THEME_COLORS[stored], LIGHT, DARK])
  })

  it.each([undefined, 'auto', 'purple'])('leaves the system in charge for %s', (stored) => {
    if (stored) store.set(THEME_STORAGE_KEY, stored)
    runBootScript()
    expect(dataset.theme).toBeUndefined()
    expect(colors()).toEqual([LIGHT, DARK])
  })

  it.each([undefined, 'light', 'dark', 'auto', 'purple'])(
    'agrees with applyThemePref for a stored %s',
    (stored) => {
      if (stored) store.set(THEME_STORAGE_KEY, stored)
      runBootScript()
      const booted = colors()
      head.children = [pageMeta(LIGHT), pageMeta(DARK)]
      applyThemePref(parseThemePref(stored ?? null))
      expect(booted).toEqual(colors())
      // and applyThemePref then finds the boot script's meta instead of adding a second one
      head.children = []
      runBootScript()
      applyThemePref(parseThemePref(stored ?? null))
      expect(colors()).toEqual(booted.slice(0, booted.length - 2))
    },
  )

  it('does not throw when storage is blocked', () => {
    vi.stubGlobal('localStorage', fakeStorage(true))
    expect(runBootScript).not.toThrow()
    expect(dataset.theme).toBeUndefined()
    expect(colors()).toEqual([LIGHT, DARK])
  })

  it('agrees with applyThemePref on the storage key and the forced meta’s mark', () => {
    expect(themeBootScript).toContain(`'${THEME_STORAGE_KEY}'`)
    expect(themeBootScript).toContain(`'${FORCED_META_ATTR}'`)
  })
})
