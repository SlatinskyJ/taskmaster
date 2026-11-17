import { describe, expect, it } from 'vitest'
import { devPagesAllowed } from './devPages'

describe('devPagesAllowed', () => {
  it('allows dev pages outside production', () => {
    expect(devPagesAllowed({ NODE_ENV: 'development' })).toBe(true)
    expect(devPagesAllowed({})).toBe(true)
  })

  it('allows them on a preview, which runs a production build', () => {
    expect(devPagesAllowed({ NODE_ENV: 'production', TASKMASTER_ENV: 'preview' })).toBe(true)
  })

  it('hides them in production', () => {
    expect(devPagesAllowed({ NODE_ENV: 'production' })).toBe(false)
    expect(devPagesAllowed({ NODE_ENV: 'production', TASKMASTER_ENV: 'prod' })).toBe(false)
  })
})
