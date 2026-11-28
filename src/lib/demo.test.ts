import { describe, expect, it, vi } from 'vitest'
import { demoHeadMeta, demoLockedMessage, makeIsDemoLoader } from './demo'
import { cs } from './strings'

// How the screens learn they are on the public demo (#328): the robots meta, the Czech lock
// error and the cached yes/no from the server.

describe('demoHeadMeta', () => {
  it('adds nothing outside the demo', () => {
    expect(demoHeadMeta(false)).toEqual([])
  })

  it('keeps search engines out on the demo', () => {
    expect(demoHeadMeta(true)).toEqual([{ name: 'robots', content: 'noindex, nofollow' }])
  })
})

describe('demoLockedMessage', () => {
  it('turns the lock refusal into Czech', () => {
    expect(demoLockedMessage(new Error('demo_locked'))).toBe(cs.demo.lockedError)
  })

  it('leaves every other failure to the screen', () => {
    expect(demoLockedMessage(new Error('forbidden'))).toBeNull()
    expect(demoLockedMessage('demo_locked')).toBeNull()
    expect(demoLockedMessage(undefined)).toBeNull()
  })
})

describe('makeIsDemoLoader', () => {
  const browser = { isServer: () => false }

  it('counts a failed call as not the demo and asks again next time', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('offline')))
    const load = makeIsDemoLoader(fetch, browser)
    expect(await load()).toBe(false)
    expect(await load()).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps an answer for the page’s life', async () => {
    const fetch = vi.fn(() => Promise.resolve(true))
    const load = makeIsDemoLoader(fetch, browser)
    expect(await load()).toBe(true)
    expect(await load()).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
