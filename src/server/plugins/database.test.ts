import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as DbModule from '~/server/db'
import { createTestDb } from '~/server/db/testing'
import { sql } from 'drizzle-orm'
import { listPeriods } from '~/server/periods'

// The boot plugin (src/server/plugins/database.ts) runs once through its real entry point over
// a test DB: it must start the scheduler (#39), whose boot tick makes the first period from the
// stored default week (#186), and Nitro's close hook must stop it.
const db = createTestDb()
vi.mock('nitro', () => ({ definePlugin: (setup: unknown) => setup }))
vi.mock('~/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getDb: () => db,
}))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('boot plugin', () => {
  it('starts the scheduler on the stored default week, and the close hook stops it', async () => {
    db.run(sql`UPDATE period_defaults SET lower_level = 60, upper_level = 120`)
    vi.useFakeTimers()
    vi.stubEnv('TASKMASTER_ENV', '')
    vi.stubEnv('ADMIN_PASSWORD', '')
    vi.stubEnv('WEBAUTHN_RP_ID', '')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const hooks: Record<string, () => void> = {}
    const nitroApp = { hooks: { hook: (name: string, fn: () => void) => (hooks[name] = fn) } }
    const { default: plugin } = (await import('~/server/plugins/database')) as unknown as {
      default: (app: typeof nitroApp) => void
    }
    plugin(nitroApp)
    expect(listPeriods(db).map((p) => [p.levels.lower, p.levels.upper])).toEqual([[60, 120]])
    expect(vi.getTimerCount()).toBe(1)
    hooks.close?.()
    expect(vi.getTimerCount()).toBe(0)
  })
})
