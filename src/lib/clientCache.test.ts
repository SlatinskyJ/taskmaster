import { describe, expect, it, vi } from 'vitest'
import { clientCache } from './clientCache'

const HOUR = 60 * 60 * 1000

function setup(isServer = false) {
  // A real-looking clock: starting at 0 would hide a `now() + at` slip.
  let t = 1_700_000_000_000
  let n = 0
  const fetch = vi.fn(() => Promise.resolve(++n))
  const get = clientCache(fetch, HOUR, { now: () => t, isServer: () => isServer })
  return {
    fetch,
    get,
    advance: (ms: number) => {
      t += ms
    },
  }
}

describe('clientCache', () => {
  it('fetches once in the browser and reuses the value while it is fresh', async () => {
    const { fetch, get, advance } = setup()
    expect(await get()).toBe(1)
    advance(HOUR - 1)
    expect(await get()).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('fetches again once the value is exactly maxAge old', async () => {
    const { fetch, get, advance } = setup()
    await get()
    advance(HOUR)
    expect(await get()).toBe(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('shares one request between calls made while it is in flight', async () => {
    const { fetch, get } = setup()
    const [a, b] = await Promise.all([get(), get()])
    expect([a, b]).toEqual([1, 1])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('never caches on the server', async () => {
    const { fetch, get } = setup(true)
    expect(await get()).toBe(1)
    expect(await get()).toBe(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('in this test process (no window) the default counts as the server and never caches', async () => {
    let n = 0
    const get = clientCache(() => Promise.resolve(++n), HOUR)
    expect(await get()).toBe(1)
    expect(await get()).toBe(2)
  })

  it('a slow failed fetch does not drop the newer value that replaced it', async () => {
    let t = 1_700_000_000_000
    let failSlow: (e: Error) => void = () => undefined
    const fetch = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise<string>((_, reject) => {
            failSlow = reject
          }),
      )
      .mockResolvedValueOnce('fresh')
    const get = clientCache(fetch, HOUR, { now: () => t, isServer: () => false })
    const slow = get()
    t += HOUR
    expect(await get()).toBe('fresh')
    failSlow(new Error('offline'))
    await expect(slow).rejects.toThrow('offline')
    expect(await get()).toBe('fresh')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not keep a failed fetch', async () => {
    const fetch = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('ok')
    const get = clientCache(fetch, HOUR, { now: () => 0, isServer: () => false })
    await expect(get()).rejects.toThrow('offline')
    expect(await get()).toBe('ok')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
