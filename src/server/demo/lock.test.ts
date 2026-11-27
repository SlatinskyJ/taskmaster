import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ status: [] as number[] }))
vi.mock('@tanstack/react-start/server', () => ({
  setResponseStatus: (code: number) => state.status.push(code),
}))

const { DemoLockedError } = await import('~/server/auth/guards')
const { demoLock } = await import('./lock')

/** Runs the middleware's server step like Start does; true when it passed the call on. */
function passes(): boolean {
  const server = (demoLock as unknown as { options: { server: (o: unknown) => unknown } }).options
    .server
  return server({ next: () => true }) === true
}

afterEach(() => {
  vi.unstubAllEnvs()
  state.status = []
})

describe('demoLock', () => {
  it('refuses on the demo with 403 demo_locked', () => {
    vi.stubEnv('TASKMASTER_ENV', 'demo')
    vi.stubEnv('ADMIN_PASSWORD', '')
    expect(passes).toThrow(DemoLockedError)
    expect(passes).toThrow('demo_locked')
    expect(state.status).toEqual([403, 403])
  })

  it('passes the call on outside the demo, and on a demo flag with ADMIN_PASSWORD', () => {
    for (const [flag, password] of [
      ['preview', ''],
      ['', ''],
      ['demo', 'x'.repeat(12)],
    ] as const) {
      vi.stubEnv('TASKMASTER_ENV', flag)
      vi.stubEnv('ADMIN_PASSWORD', password)
      expect(passes()).toBe(true)
    }
    expect(state.status).toEqual([])
  })
})
