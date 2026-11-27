import { useCallback, useSyncExternalStore } from 'react'
import {
  FORCED_META_ATTR,
  THEME_STORAGE_KEY,
  forcedThemeColor,
  parseThemePref,
  type ThemePref,
} from './themeColor'

// Light / dark / auto (UI doc §1, §7.4). `auto` follows the system; the others set
// `data-theme` on <html>, which src/styles/theme.css reads, and force the theme-color.
// Stored on this device; the profile screen (#31) decides whether it also follows the user.

export {
  FORCED_META_ATTR,
  THEME_COLORS,
  THEME_PREFS,
  THEME_STORAGE_KEY,
  forcedThemeColor,
  parseThemePref,
  themeBootScript,
  type ThemePref,
} from './themeColor'

/** The forced theme-color meta (see themeBootScript): added, updated, or removed for `auto`. */
function applyThemeColor(pref: ThemePref): void {
  const color = forcedThemeColor(pref)
  let meta = document.querySelector<HTMLMetaElement>(`meta[${FORCED_META_ATTR}]`)
  if (color === undefined) {
    meta?.remove()
    return
  }
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.setAttribute(FORCED_META_ATTR, '')
    document.head.prepend(meta)
  }
  meta.content = color
}

function readStored(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'auto'
  }
}

export function applyThemePref(pref: ThemePref): void {
  const root = document.documentElement
  if (pref === 'auto') delete root.dataset.theme
  else root.dataset.theme = pref
  applyThemeColor(pref)
  try {
    if (pref === 'auto') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    // Private mode or blocked storage: the choice still applies until reload.
  }
  for (const listener of listeners) listener()
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

function subscribeResolved(listener: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY)
  media.addEventListener('change', listener)
  const off = subscribe(listener)
  return () => {
    media.removeEventListener('change', listener)
    off()
  }
}

function readResolved(): 'light' | 'dark' {
  const pref = readStored()
  if (pref !== 'auto') return pref
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/** Current preference and a setter, for the profile switch. Server render reads `auto`. */
export function useThemePref(): [ThemePref, (pref: ThemePref) => void] {
  const pref = useSyncExternalStore(subscribe, readStored, () => 'auto' as const)
  const set = useCallback((next: ThemePref) => {
    applyThemePref(next)
  }, [])
  return [pref, set]
}

/** The theme actually showing (`auto` resolved through the system), for widgets that need it. */
export function useResolvedTheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribeResolved, readResolved, () => 'light' as const)
}
