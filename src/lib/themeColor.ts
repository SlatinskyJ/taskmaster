// The theme choice and its colours, without React (UI doc §1, §2.1, §7.4). Imported by
// vite.config.ts through src/pwa/offline.ts: relative imports only, no React. The hooks live
// in ./theme, which re-exports all of this.

export const THEME_PREFS = ['auto', 'light', 'dark'] as const
export type ThemePref = (typeof THEME_PREFS)[number]

export const THEME_STORAGE_KEY = 'tm-theme'

export function parseThemePref(value: unknown): ThemePref {
  return value === 'light' || value === 'dark' ? value : 'auto'
}

/** Page background (UI doc §2.1 `bg`), used for the browser and status bar colour. */
export const THEME_COLORS = { light: '#FFF5EE', dark: '#1D1524' } as const

/** Marks the one theme-color meta that a forced theme adds. */
export const FORCED_META_ATTR = 'data-tm-forced'

/** The browser colour of a forced theme; `auto` forces none (the page's two metas decide). */
export function forcedThemeColor(pref: ThemePref): string | undefined {
  return pref === 'auto' ? undefined : THEME_COLORS[pref]
}

/**
 * Runs inline in <head> before first paint, so a forced theme never flashes the other one:
 * sets `data-theme`, and adds a theme-color meta with no media as the first one in <head>.
 * The browser uses the first theme-color that matches, so it wins over the page's
 * light and dark metas, which stay as the server rendered them: React matches those by their
 * content when it hydrates, and would add new ones if a script changed them (#124).
 * Keep it tiny and dependency-free: it is serialised into the HTML as a string, in the app and
 * in the offline page.
 */
export const themeBootScript = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;var m=document.createElement('meta');m.name='theme-color';m.content=t==='dark'?'${THEME_COLORS.dark}':'${THEME_COLORS.light}';m.setAttribute('${FORCED_META_ATTR}','');document.head.prepend(m)}}catch(e){}`
