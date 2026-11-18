// The service worker (spec §11, PWA [call]). Built by src/pwa/vite-plugin.ts into /sw.js as a
// classic script with no imports; the plugin replaces __TM_SW_BUILD__ with this build's data.
//
// - Install: precache this build's hashed assets and shell files into `tm-shell-<version>`.
// - Activate: delete older shell caches and take over open pages at once. After the takeover,
//   the page's next navigation is a full page load (src/pwa/register.ts), so it does not keep
//   running an old shell against a new server.
// - Fetch: see strategyFor(). HTML, /api and server functions are never cached.

import { cacheName, staleCaches, strategyFor } from './policy'

interface SwBuild {
  version: string
  precache: string[]
  offlineHtml: string
}

declare const __TM_SW_BUILD__: SwBuild

// Minimal service worker types: the project compiles against the DOM lib, not WebWorker.
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request
  respondWith(response: Promise<Response>): void
}
interface ServiceWorkerScope {
  readonly location: Location
  skipWaiting(): Promise<void>
  readonly clients: { claim(): Promise<void> }
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void
}

const sw = self as unknown as ServiceWorkerScope
const build = __TM_SW_BUILD__
const CACHE = cacheName(build.version)

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // `no-cache`: revalidate with the server, so a stale HTTP copy never lands in a new cache.
      await cache.addAll(build.precache.map((path) => new Request(path, { cache: 'no-cache' })))
      await sw.skipWaiting()
    })(),
  )
})

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const stale = staleCaches(await caches.keys(), build.version)
      await Promise.all(stale.map((name) => caches.delete(name)))
      await sw.clients.claim()
    })(),
  )
})

sw.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request, sw.location.origin)
  if (strategy === 'cache') event.respondWith(fromCache(event.request))
  else if (strategy === 'navigation') event.respondWith(fromNetwork(event.request))
})

async function fromCache(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

async function fromNetwork(request: Request): Promise<Response> {
  try {
    return await fetch(request)
  } catch {
    return new Response(build.offlineHtml, {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}
