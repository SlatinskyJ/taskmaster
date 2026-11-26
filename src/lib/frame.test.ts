import { describe, expect, it } from 'vitest'
import {
  frameHeader,
  frameNameFor,
  frameReentryUrl,
  guardedReentryUrl,
  keepFrameToken,
  tokenInFrameName,
} from './frame'
import type { ReentryStore } from './frame'

const at = (name: string, href: string) => ({ name, location: { href } })

describe('frameHeader', () => {
  it('outside a frame: no header', () => {
    expect(frameHeader(undefined)).toEqual({})
    expect(frameHeader({ name: '' })).toEqual({})
    expect(frameHeader({ name: 'other' })).toEqual({})
  })

  it('in a frame: its token, or the no-token sentinel', () => {
    expect(frameHeader({ name: 'tm-frame:abc' })).toEqual({ 'x-tm-frame': 'abc' })
    expect(frameHeader({ name: 'tm-frame:' })).toEqual({ 'x-tm-frame': '-' })
  })
})

describe('frameReentryUrl', () => {
  it('null outside a frame', () => {
    expect(frameReentryUrl(at('', 'https://x/ukoly'))).toBeNull()
  })

  it('null outside a frame even when the URL carries tmFrame (a frame link opened in a tab)', () => {
    expect(frameReentryUrl(at('', 'https://x/?tmFrame=abc'))).toBeNull()
  })

  it('null in a frame with no token', () => {
    expect(frameReentryUrl(at('tm-frame:', 'https://x/ukoly'))).toBeNull()
  })

  it('null when tmFrame already matches', () => {
    expect(frameReentryUrl(at('tm-frame:abc', 'https://x/ukoly?tmFrame=abc'))).toBeNull()
  })

  it('adds the token to a URL without it', () => {
    expect(frameReentryUrl(at('tm-frame:abc', 'https://x/ukoly?a=1'))).toBe(
      'https://x/ukoly?a=1&tmFrame=abc',
    )
  })

  it('replaces a different tmFrame', () => {
    expect(frameReentryUrl(at('tm-frame:abc', 'https://x/login?tmFrame=-'))).toBe(
      'https://x/login?tmFrame=abc',
    )
  })
})

describe('keepFrameToken', () => {
  it('stores the token in a frame', () => {
    const frame = { name: 'tm-frame:' }
    keepFrameToken(frame, 'abc')
    expect(frame.name).toBe('tm-frame:abc')
    keepFrameToken(frame, undefined)
    expect(frame.name).toBe('tm-frame:')
  })

  it('does nothing outside a frame', () => {
    const page = { name: 'other' }
    keepFrameToken(page, 'abc')
    expect(page.name).toBe('other')
    expect(() => {
      keepFrameToken(undefined, 'abc')
    }).not.toThrow()
  })
})

describe('guardedReentryUrl', () => {
  const fakeStore = () => {
    const map = new Map<string, string>()
    const store: ReentryStore = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        map.set(k, v)
      },
    }
    return { map, store }
  }
  const SPRAVA = at('tm-frame:abc', 'http://x/sprava')
  const WANT = 'http://x/sprava?tmFrame=abc'

  it('re-enters once, refuses again within 5 s, and re-enters after', () => {
    const { map, store } = fakeStore()
    expect(guardedReentryUrl(SPRAVA, store, 1000)).toBe(WANT)
    expect(map.get('tm.frameReentry:tm-frame:abc')).toBe(JSON.stringify({ url: WANT, at: 1000 }))
    expect(guardedReentryUrl(SPRAVA, store, 1000 + 4999)).toBeNull()
    expect(guardedReentryUrl(SPRAVA, store, 1000 + 5000)).toBe(WANT)
  })

  it('another address in the same frame is its own', () => {
    const { store } = fakeStore()
    guardedReentryUrl(SPRAVA, store, 1000)
    expect(guardedReentryUrl(at('tm-frame:abc', 'http://x/ukoly'), store, 1001)).toBe(
      'http://x/ukoly?tmFrame=abc',
    )
  })

  it('another frame at the same address has its own memory', () => {
    const { store } = fakeStore()
    guardedReentryUrl(SPRAVA, store, 1000)
    expect(guardedReentryUrl(at('tm-frame:def', 'http://x/sprava'), store, 1001)).toBe(
      'http://x/sprava?tmFrame=def',
    )
  })

  it('no storage, a throwing one or unreadable memory: re-enters every time', () => {
    expect(guardedReentryUrl(SPRAVA, undefined, 1000)).toBe(WANT)
    expect(guardedReentryUrl(SPRAVA, undefined, 1001)).toBe(WANT)
    const throwing: ReentryStore = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(guardedReentryUrl(SPRAVA, throwing, 1000)).toBe(WANT)
    expect(guardedReentryUrl(SPRAVA, throwing, 1001)).toBe(WANT)
    const broken: ReentryStore = { getItem: () => '{', setItem: () => undefined }
    expect(guardedReentryUrl(SPRAVA, broken, 1000)).toBe(WANT)
  })

  it('not a frame, or no token: null, and the store is not touched', () => {
    const { map, store } = fakeStore()
    expect(guardedReentryUrl(at('', 'http://x/sprava'), store, 1000)).toBeNull()
    expect(guardedReentryUrl(at('tm-frame:', 'http://x/sprava'), store, 1000)).toBeNull()
    expect(map.size).toBe(0)
  })
})

describe('frameNameFor and tokenInFrameName', () => {
  it('names a frame by its token', () => {
    expect(frameNameFor(undefined)).toBe('tm-frame:')
    expect(frameNameFor(null)).toBe('tm-frame:')
    expect(frameNameFor('abc')).toBe('tm-frame:abc')
  })

  it('reads the token back: undefined for none, null for a name that is not a frame', () => {
    expect(tokenInFrameName('tm-frame:abc')).toBe('abc')
    expect(tokenInFrameName('tm-frame:')).toBeUndefined()
    expect(tokenInFrameName('')).toBeNull()
    expect(tokenInFrameName('other')).toBeNull()
  })
})
