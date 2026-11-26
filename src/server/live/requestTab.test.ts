import { describe, expect, it, vi } from 'vitest'
import { requestTab } from './hub'

// The origin tab of a change (#299): the request's `x-tm-tab` header, bounded, and nothing
// outside a request (the scheduler).

const req = vi.hoisted(() => ({ tab: undefined as string | undefined, inRequest: true }))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeader: (name: string) => {
    if (!req.inRequest) throw new Error('no request context')
    return name === 'x-tm-tab' ? req.tab : undefined
  },
}))

describe('requestTab', () => {
  it('a 64-character tab is accepted, 65 refused', () => {
    req.inRequest = true
    req.tab = 'a'.repeat(64)
    expect(requestTab()).toBe('a'.repeat(64))
    req.tab = 'a'.repeat(65)
    expect(requestTab()).toBeUndefined()
  })

  it('no header or an empty one is undefined', () => {
    req.inRequest = true
    req.tab = undefined
    expect(requestTab()).toBeUndefined()
    req.tab = ''
    expect(requestTab()).toBeUndefined()
  })

  it('outside a request it is undefined', () => {
    req.inRequest = false
    req.tab = 'tab-1'
    expect(requestTab()).toBeUndefined()
  })
})
