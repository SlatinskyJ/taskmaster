// Registers the service worker (src/pwa/sw.ts) in production builds only; dev has no sw.js.
// Keep this module free of imports from ./policy, so the worker's code stays in sw.js alone.

/** The part of the TanStack router this module needs (router.subscribe). */
export interface NavigationEvents {
  subscribe(
    type: 'onBeforeNavigate',
    listener: (event: { hrefChanged: boolean; toLocation: { href: string } }) => void,
  ): () => void
}

export function registerServiceWorker(router: NavigationEvents): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const container = navigator.serviceWorker

  // A new deploy installs a new worker, which takes over at once (skipWaiting + claim) and
  // deletes the old shell cache. The page must not keep running the old shell against the new
  // server, but reloading on the spot could throw away a half-filled form. So the next
  // navigation inside the app becomes a full page load instead. The first install also fires
  // this event, but then there is no old shell to replace.
  const hadController = container.controller !== null
  let updated = false
  container.addEventListener('controllerchange', () => {
    if (hadController) updated = true
  })
  let leaving = false
  router.subscribe('onBeforeNavigate', (event) => {
    if (!updated || leaving || !event.hrefChanged) return
    leaving = true
    // The router has already put the new URL into history, so replace it, not push it.
    window.location.replace(event.toLocation.href)
  })

  container
    .register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .then((registration) => {
      // Client-side navigation never reloads the page, so look for a new deploy whenever the
      // app comes back to the foreground (an installed app can stay open for days).
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => undefined)
      })
    })
    .catch((error: unknown) => {
      console.warn('[pwa] service worker registration failed', error)
    })
}
