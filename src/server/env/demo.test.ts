import { describe, expect, it } from 'vitest'
import { assertDemoProxy, demoDataAllowed, isDemo } from './demo'

describe('isDemo', () => {
  it('is true only for TASKMASTER_ENV=demo without ADMIN_PASSWORD', () => {
    expect(isDemo({ TASKMASTER_ENV: 'demo' })).toBe(true)
    expect(isDemo({ TASKMASTER_ENV: 'demo', ADMIN_PASSWORD: '' })).toBe(true)
  })

  it('is false when ADMIN_PASSWORD is set, so a leaked flag turns nothing on', () => {
    expect(isDemo({ TASKMASTER_ENV: 'demo', ADMIN_PASSWORD: 'x' })).toBe(false)
  })

  it('is false for anything else', () => {
    for (const value of ['preview', '', 'Demo', 'demo ', undefined]) {
      expect(isDemo({ TASKMASTER_ENV: value })).toBe(false)
    }
    expect(isDemo({})).toBe(false)
  })
})

describe('demoDataAllowed', () => {
  it('allows a preview and the demo', () => {
    expect(demoDataAllowed({ TASKMASTER_ENV: 'preview' })).toBe(true)
    expect(demoDataAllowed({ TASKMASTER_ENV: 'demo' })).toBe(true)
  })

  it('refuses everything else, and the demo with ADMIN_PASSWORD', () => {
    expect(demoDataAllowed({})).toBe(false)
    expect(demoDataAllowed({ TASKMASTER_ENV: 'prod' })).toBe(false)
    expect(demoDataAllowed({ TASKMASTER_ENV: 'demo', ADMIN_PASSWORD: 'x' })).toBe(false)
  })
})

const boot = (env: NodeJS.ProcessEnv) => () => {
  assertDemoProxy(env)
}

describe('assertDemoProxy', () => {
  it('throws on the demo without TRUST_PROXY=1', () => {
    expect(boot({ TASKMASTER_ENV: 'demo' })).toThrow(/TRUST_PROXY=1/)
    expect(boot({ TASKMASTER_ENV: 'demo', TRUST_PROXY: 'true' })).toThrow()
  })

  it('passes on the demo with TRUST_PROXY=1, and outside the demo', () => {
    expect(boot({ TASKMASTER_ENV: 'demo', TRUST_PROXY: '1' })).not.toThrow()
    expect(boot({ TASKMASTER_ENV: 'preview' })).not.toThrow()
    expect(boot({})).not.toThrow()
    expect(boot({ TASKMASTER_ENV: 'demo', ADMIN_PASSWORD: 'x' })).not.toThrow()
  })
})
