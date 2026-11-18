// Service worker caching policy (spec §11, PWA [call]): app-shell cache only, no user data.
// Pure and framework-free so it is unit-tested; src/pwa/sw.ts applies it to real requests.

/** Every shell cache name starts with this; the build version follows. */
export const CACHE_PREFIX = 'tm-shell-'

export function cacheName(version: string): string {
  return `${CACHE_PREFIX}${version}`
}

/** Shell caches left by older builds, to delete when a new worker activates. */
export function staleCaches(names: readonly string[], version: string): string[] {
  const current = cacheName(version)
  return names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== current)
}

/** Static files outside /assets/ that belong to the shell (served from public/). */
export const SHELL_FILES = [
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
] as const

/**
 * - `cache`: a static shell file; serve from the shell cache, fetch and store on a miss.
 * - `navigation`: an HTML page; always from the network (it carries user data), with an
 *   offline notice when the network is down. Never stored.
 * - `network`: leave it to the browser; the worker does not touch it.
 */
export type Strategy = 'cache' | 'navigation' | 'network'

export interface RequestLike {
  url: string
  method: string
  mode: string
}

/**
 * Allowlist: only GETs for hashed build assets (/assets/, content-hashed names, so a cached
 * copy is never stale) and the fixed shell files are cached. API routes, server functions
 * and anything else, including other origins, go straight to the network.
 */
export function strategyFor(request: RequestLike, origin: string): Strategy {
  if (request.method !== 'GET') return 'network'
  const url = new URL(request.url)
  if (url.origin !== origin) return 'network'
  if (request.mode === 'navigate') return 'navigation'
  const path = url.pathname
  if (path.startsWith('/api/') || path.startsWith('/_serverFn/')) return 'network'
  if (url.search !== '') return 'network'
  if (path.startsWith('/assets/') || (SHELL_FILES as readonly string[]).includes(path)) {
    return 'cache'
  }
  return 'network'
}
