import { describe, expect, it } from 'vitest'
import { frameRedirectLocation, frameSignals, readFrame } from './frame'

const PROD = { NODE_ENV: 'production' }
const PREVIEW = { NODE_ENV: 'production', TASKMASTER_ENV: 'preview' }
const NONE = { header: undefined, query: undefined, fetchDest: undefined }

describe('readFrame', () => {
  it('production ignores every frame signal', () => {
    expect(readFrame(PROD, { header: 'abc', query: 'abc', fetchDest: 'iframe' })).toEqual({
      inFrame: false,
    })
  })

  it('preview: header wins over query', () => {
    expect(readFrame(PREVIEW, { ...NONE, header: 'h', query: 'q' })).toEqual({
      inFrame: true,
      token: 'h',
    })
  })

  it('preview: the no-token sentinel is a frame with no token', () => {
    expect(readFrame(PREVIEW, { ...NONE, header: '-' })).toEqual({
      inFrame: true,
      token: undefined,
    })
    expect(readFrame(PREVIEW, { ...NONE, header: '' })).toEqual({
      inFrame: true,
      token: undefined,
    })
    expect(readFrame(PREVIEW, { ...NONE, query: '-' })).toEqual({
      inFrame: true,
      token: undefined,
    })
  })

  it('preview: query on a document load', () => {
    expect(readFrame(PREVIEW, { ...NONE, query: 'q', fetchDest: 'iframe' })).toEqual({
      inFrame: true,
      token: 'q',
    })
  })

  it('preview: an iframe load without header or query is a frame with no token', () => {
    expect(readFrame(PREVIEW, { ...NONE, fetchDest: 'iframe' })).toEqual({
      inFrame: true,
      token: undefined,
    })
  })

  it('preview: a normal request is not a frame', () => {
    expect(readFrame(PREVIEW, { ...NONE, fetchDest: 'document' })).toEqual({ inFrame: false })
    expect(readFrame(PREVIEW, NONE)).toEqual({ inFrame: false })
  })

  it('dev (not production) reads frames too', () => {
    expect(readFrame({ NODE_ENV: 'development' }, { ...NONE, header: 'h' })).toEqual({
      inFrame: true,
      token: 'h',
    })
  })
})

describe('frameRedirectLocation', () => {
  const REQ = 'http://localhost:3000/?tmFrame=tok'
  const FRAME = { ...NONE, query: 'tok', fetchDest: 'iframe' }

  it('same-origin path: adds the frame token', () => {
    expect(frameRedirectLocation(PREVIEW, FRAME, REQ, '/sprava')).toBe('/sprava?tmFrame=tok')
  })

  it('keeps the query and hash and replaces an old token', () => {
    expect(
      frameRedirectLocation(PREVIEW, FRAME, REQ, '/login?redirect=%2Fsprava&tmFrame=old#x'),
    ).toBe('/login?redirect=%2Fsprava&tmFrame=tok#x')
  })

  it('same-origin absolute URL: returns a path', () => {
    expect(frameRedirectLocation(PREVIEW, FRAME, REQ, 'http://localhost:3000/sprava')).toBe(
      '/sprava?tmFrame=tok',
    )
  })

  it('copies the no-token sentinel', () => {
    expect(
      frameRedirectLocation(PREVIEW, { ...NONE, query: '-' }, REQ, '/login?redirect=%2F'),
    ).toBe('/login?redirect=%2F&tmFrame=-')
  })

  it.each([
    'https://evil.example/x',
    '//evil.example/x',
    '/\\evil.example/x',
    'javascript:alert(1)',
    '/.//evil.example',
    '/./\\evil.example',
    'http://localhost:3001/x',
    'https://localhost:3000/x',
  ])('off-site Location %s: untouched', (location) => {
    expect(frameRedirectLocation(PREVIEW, FRAME, REQ, location)).toBeNull()
  })

  it('an unparsable Location or request URL: untouched', () => {
    expect(frameRedirectLocation(PREVIEW, FRAME, 'not a url', '/sprava')).toBeNull()
    expect(frameRedirectLocation(PREVIEW, FRAME, REQ, 'http://[')).toBeNull()
  })

  it('production: untouched with every frame signal present', () => {
    expect(
      frameRedirectLocation(
        PROD,
        { header: undefined, query: 'tok', fetchDest: 'iframe' },
        REQ,
        '/sprava',
      ),
    ).toBeNull()
  })

  it('a frame request by header: untouched', () => {
    expect(frameRedirectLocation(PREVIEW, { ...NONE, header: 'tok' }, REQ, '/sprava')).toBeNull()
    expect(
      frameRedirectLocation(PREVIEW, { ...NONE, header: 'tok', query: 'tok' }, REQ, '/sprava'),
    ).toBeNull()
  })

  it('not a frame, or a frame without the query: untouched', () => {
    expect(frameRedirectLocation(PREVIEW, NONE, REQ, '/sprava')).toBeNull()
    expect(
      frameRedirectLocation(PREVIEW, { ...NONE, fetchDest: 'iframe' }, REQ, '/sprava'),
    ).toBeNull()
  })
})

describe('frameSignals', () => {
  it('maps the header, the query and Sec-Fetch-Dest', () => {
    const headers: Record<string, string> = { 'x-tm-frame': 'h', 'sec-fetch-dest': 'iframe' }
    expect(frameSignals((n) => headers[n], new URL('http://x/?tmFrame=q'))).toEqual({
      header: 'h',
      query: 'q',
      fetchDest: 'iframe',
    })
  })

  it('leaves absent signals undefined', () => {
    expect(frameSignals(() => undefined, new URL('http://x/sprava'))).toEqual(NONE)
  })
})
