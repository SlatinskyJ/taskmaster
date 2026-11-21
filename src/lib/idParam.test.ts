import { describe, expect, it } from 'vitest'
import { parseIdParam } from './idParam'

describe('parseIdParam', () => {
  it('an id in the URL: plain positive digits only', () => {
    expect(
      ['7', '0', '-1', '1.5', 'abc', '1e3', ' 7', '9007199254740993'].map(parseIdParam),
    ).toEqual([7, null, null, null, null, null, null, null])
  })
})
