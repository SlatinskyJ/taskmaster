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

/**
 * The colour of one theme-color meta: a forced theme sets every meta to its page colour;
 * `auto` gives each meta the colour of the scheme its `media` names.
 */
export function themeColorFor(pref: ThemePref, media: string): string {
  if (pref !== 'auto') return THEME_COLORS[pref]
  return media.includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light
}

/**
 * Runs inline in <head> before first paint, so a forced theme never flashes the other one:
 * sets `data-theme` and the theme-color metas (the same rule as themeColorFor), so it must
 * come after those metas. Keep it tiny and dependency-free: it is serialised into the HTML as
 * a string, in the app and in the offline page.
 */
export const themeBootScript = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}'),f=t==='light'||t==='dark',c={light:'${THEME_COLORS.light}',dark:'${THEME_COLORS.dark}'};if(f)document.documentElement.dataset.theme=t;document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.content=c[f?t:m.media.indexOf('dark')>=0?'dark':'light']})}catch(e){}`
