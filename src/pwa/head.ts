// <head> tags that make the app installable (spec §11, PWA [call]): the web manifest, icons,
// and the iOS tags Safari still reads instead of the manifest.

import { cs } from '~/lib/strings'

/** Page background (UI doc §2.1 `bg`), used for the browser and status bar colour. */
export const THEME_COLORS = { light: '#FFF5EE', dark: '#1D1524' } as const

/**
 * One theme-color per colour scheme. Rendered straight into <head> by the root route, because
 * the router's head() keeps only one meta per name.
 */
export const themeColorMeta = [
  { name: 'theme-color', content: THEME_COLORS.light, media: '(prefers-color-scheme: light)' },
  { name: 'theme-color', content: THEME_COLORS.dark, media: '(prefers-color-scheme: dark)' },
]

export const pwaMeta = [
  { name: 'mobile-web-app-capable', content: 'yes' },
  { name: 'apple-mobile-web-app-capable', content: 'yes' },
  { name: 'apple-mobile-web-app-title', content: cs.app.name },
  // `default`: a normal status bar above the page. `black-translucent` would draw the page
  // under it and need safe-area padding on every screen.
  { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
]

export const pwaLinks = [
  { rel: 'manifest', href: '/manifest.webmanifest' },
  { rel: 'icon', href: '/icons/icon.svg', type: 'image/svg+xml' },
  { rel: 'icon', href: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
  { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png', sizes: '180x180' },
]
