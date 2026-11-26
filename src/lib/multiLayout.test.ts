import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYOUT,
  type Device,
  frameName,
  frameSrc,
  needsLogin,
  newDeviceId,
  parseLayout,
  safePath,
  serializeLayout,
  tokenFromName,
} from './multiLayout'

const device = (over: Partial<Device> = {}): Device => ({
  id: 'd1',
  user: 'tata',
  size: 'phone',
  path: '/',
  token: undefined,
  ...over,
})

describe('parseLayout', () => {
  it.each([null, '{', '[]', '{"a":1}', '"x"', 'null'])('%s → the default layout', (raw) => {
    expect(parseLayout(raw)).toEqual(DEFAULT_LAYOUT)
  })

  it('returns a copy of the default, not the default itself', () => {
    expect(parseLayout(null)).not.toBe(DEFAULT_LAYOUT)
  })

  it('the default is tata, starsi, mladsi on phones at /, not logged in', () => {
    expect(DEFAULT_LAYOUT).toEqual([
      device({ id: 'd1', user: 'tata' }),
      device({ id: 'd2', user: 'starsi' }),
      device({ id: 'd3', user: 'mladsi' }),
    ])
  })

  it('keeps valid entries and drops unknown users and sizes', () => {
    const raw = JSON.stringify([
      { id: 'd1', user: 'admin', size: 'tablet', path: '/', token: 'a' },
      { id: 'd2', user: 'mama', size: 'phone', path: '/', token: 'b' },
      { id: 'd3', user: 'tata', size: 'watch', path: '/', token: 'c' },
      7,
      null,
      { id: 'd4', user: 'mladsi', size: 'small', path: '/tyden', token: 'd' },
    ])
    expect(parseLayout(raw)).toEqual([
      device({ id: 'd1', user: 'admin', size: 'tablet', token: 'a' }),
      device({ id: 'd4', user: 'mladsi', size: 'small', path: '/tyden', token: 'd' }),
    ])
  })

  it('an entry without a string id is dropped', () => {
    const raw = JSON.stringify([{ user: 'tata', size: 'phone', path: '/' }])
    expect(parseLayout(raw)).toEqual(DEFAULT_LAYOUT)
  })

  it('only invalid entries → the default layout', () => {
    expect(parseLayout(JSON.stringify([{ id: 'd1', user: 'mama', size: 'phone' }]))).toEqual(
      DEFAULT_LAYOUT,
    )
  })

  it('round-trips through serializeLayout', () => {
    const x = [
      device({ id: 'd1', user: 'admin', size: 'tablet', path: '/tyden?a=1', token: 'abc' }),
      device({ id: 'd5', user: 'starsi', token: null }),
    ]
    expect(parseLayout(serializeLayout(x))).toEqual(x)
  })

  it('keeps token null, and turns a non-string or empty token into undefined', () => {
    const raw = JSON.stringify([
      { id: 'd1', user: 'tata', size: 'phone', path: '/', token: null },
      { id: 'd2', user: 'tata', size: 'phone', path: '/', token: 5 },
      { id: 'd3', user: 'tata', size: 'phone', path: '/', token: '' },
      { id: 'd4', user: 'tata', size: 'phone', path: '/' },
    ])
    expect(parseLayout(raw).map((d) => d.token)).toEqual([null, undefined, undefined, undefined])
  })

  it('a stored unsafe or missing path becomes /', () => {
    const raw = JSON.stringify([
      { id: 'd1', user: 'tata', size: 'phone', path: '//evil' },
      { id: 'd2', user: 'tata', size: 'phone', path: 42 },
    ])
    expect(parseLayout(raw).map((d) => d.path)).toEqual(['/', '/'])
  })
})

describe('safePath', () => {
  it.each([
    ['', '/'],
    ['   ', '/'],
    ['ukoly', '/ukoly'],
    [' /tyden ', '/tyden'],
    ['/ukoly?a=1#x', '/ukoly?a=1#x'],
    ['/?tmFrame=abc&b=2', '/?b=2'],
    ['/tyden?tmFrame=abc', '/tyden'],
    ['//evil.example/x', null],
    ['/\\evil.example/x', null],
    ['https://evil.example/x', null],
    ['http://x/ukoly', null],
    ['javascript:alert(1)', null],
    ['data:text/html,hi', null],
  ])('%j → %j', (input, expected) => {
    expect(safePath(input)).toBe(expected)
  })
})

describe('needsLogin', () => {
  it('only a frame the viewer never logged in needs a login', () => {
    expect(needsLogin(device({ token: undefined }))).toBe(true)
    expect(needsLogin(device({ token: null }))).toBe(false)
    expect(needsLogin(device({ token: 'abc' }))).toBe(false)
  })
})

describe('frameSrc', () => {
  it('adds the token, or - for none', () => {
    expect(frameSrc(device({ path: '/tyden', token: 'abc' }))).toBe('/tyden?tmFrame=abc')
    expect(frameSrc(device({ path: '/tyden', token: undefined }))).toBe('/tyden?tmFrame=-')
    expect(frameSrc(device({ path: '/tyden', token: null }))).toBe('/tyden?tmFrame=-')
  })

  it('replaces an existing tmFrame instead of adding a second one', () => {
    expect(frameSrc(device({ path: '/?tmFrame=old', token: 'new' }))).toBe('/?tmFrame=new')
  })

  it('keeps the rest of the query and the hash', () => {
    expect(frameSrc(device({ path: '/ukoly?a=1#x', token: 'abc' }))).toBe(
      '/ukoly?a=1&tmFrame=abc#x',
    )
  })

  it('an unsafe path opens /', () => {
    expect(frameSrc(device({ path: '//evil.example/x', token: 'abc' }))).toBe('/?tmFrame=abc')
  })
})

describe('frameName and tokenFromName', () => {
  it('names a frame by its token', () => {
    expect(frameName(undefined)).toBe('tm-frame:')
    expect(frameName(null)).toBe('tm-frame:')
    expect(frameName('abc')).toBe('tm-frame:abc')
  })

  it('reads the token back', () => {
    expect(tokenFromName('tm-frame:abc')).toEqual({ token: 'abc' })
    expect(tokenFromName('tm-frame:')).toEqual({ token: null })
    expect(tokenFromName('')).toBeNull()
    expect(tokenFromName('other')).toBeNull()
  })
})

describe('newDeviceId', () => {
  it('is one past the highest id, never a duplicate', () => {
    expect(newDeviceId(DEFAULT_LAYOUT)).toBe('d4')
    expect(newDeviceId([])).toBe('d1')
    expect(newDeviceId([device({ id: 'd1' }), device({ id: 'd3' })])).toBe('d4')
    expect(newDeviceId([device({ id: 'x' }), device({ id: 'd2' })])).toBe('d3')
  })
})
