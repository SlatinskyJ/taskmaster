import { describe, expect, it } from 'vitest'
import { frameHeader, frameReentryUrl, keepFrameToken } from './frame'

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
