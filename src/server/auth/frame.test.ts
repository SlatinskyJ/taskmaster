import { describe, expect, it } from 'vitest'
import { readFrame } from './frame'

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
