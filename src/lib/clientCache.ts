/**
 * Caches one async value in the browser for `maxAgeMs`; a page reload starts empty.
 * On the server (SSR) it never caches: module state there is shared by every request and user.
 * A failed fetch is not kept, so the next call tries again. `forget()` drops the cached value, so
 * the next call fetches (e.g. right after this browser changed it).
 */
export function clientCache<T>(
  fetch: () => Promise<T>,
  maxAgeMs: number,
  {
    now = Date.now,
    isServer = () => typeof window === 'undefined',
  }: { now?: () => number; isServer?: () => boolean } = {},
): (() => Promise<T>) & { forget(): void } {
  let entry: { at: number; value: Promise<T> } | undefined
  const get = () => {
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
  return Object.assign(get, {
    forget: () => {
      entry = undefined
    },
  })
}
