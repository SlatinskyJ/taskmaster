// Registers the service worker (src/pwa/sw.ts) in production builds only; dev has no sw.js.
// Keep this module free of imports from ./policy, so the worker's code stays in sw.js alone.

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const container = navigator.serviceWorker

  // A new deploy installs a new worker, which takes over at once (skipWaiting + claim) and
  // deletes the old shell cache. Reload then, so the page never runs the old shell against
  // the new server. The first install also fires this event, but with no page to replace.
  const hadController = container.controller !== null
  let reloading = false
  container.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
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
