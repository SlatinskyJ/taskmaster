/**
 * Caches one async value in the browser for `maxAgeMs`; a page reload starts empty.
 * On the server (SSR) it never caches: module state there is shared by every request and user.
 * A failed fetch is not kept, so the next call tries again.
 */
export function clientCache<T>(
  fetch: () => Promise<T>,
  maxAgeMs: number,
  {
    now = Date.now,
    isServer = () => typeof window === 'undefined',
  }: { now?: () => number; isServer?: () => boolean } = {},
): () => Promise<T> {
  let entry: { at: number; value: Promise<T> } | undefined
  return () => {
    if (isServer()) return fetch()
    if (entry && now() - entry.at < maxAgeMs) return entry.value
    const value = fetch()
    const current = { at: now(), value }
    entry = current
    value.catch(() => {
      if (entry === current) entry = undefined
    })
    return value
  }
}
