import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SUITES, suiteServers } from '../e2e/suites'
import { isSeedName } from '~/server/demo'

// Every browser-test spec runs in exactly one suite with its own server, database and seed
// (#183). A spec with no row would match no project and silently drop out of CI.

const SPECS = readdirSync(join(import.meta.dirname, '..', 'e2e'))
  .filter((f) => f.endsWith('.spec.ts'))
  .sort()

describe('e2e suites (#183)', () => {
  it('every spec file has exactly one suite, and every suite a real spec', () => {
    const specs = SUITES.map((s) => s.spec)
    expect(new Set(specs).size).toBe(specs.length)
    expect([...specs].sort()).toEqual(SPECS)
    expect(new Set(SUITES.map((s) => s.name)).size).toBe(SUITES.length)
  })

  it('each suite gets its own server', () => {
    const servers = suiteServers()
    expect(new Set(servers.map((s) => s.port)).size).toBe(servers.length)
    expect(new Set(servers.map((s) => s.env.DATA_DIR)).size).toBe(servers.length)
    for (const { suite, port, env } of servers) {
      expect(env.PORT).toBe(String(port))
      // The `demo` suite runs the public demo; every other suite a preview.
      expect(env.TASKMASTER_ENV).toBe(suite.name === 'demo' ? 'demo' : 'preview')
      expect(env.TASKMASTER_SEED).toBe(suite.seed)
      expect(isSeedName(env.TASKMASTER_SEED)).toBe(true)
    }
  })

  it('passkeys are on for the `on` suite only, at its own origin', () => {
    for (const { suite, port, env } of suiteServers()) {
      const origin = (env as Record<string, string | undefined>).WEBAUTHN_ORIGIN
      expect(origin, suite.name).toBe(
        suite.name === 'on' ? `http://localhost:${String(port)}` : undefined,
      )
    }
  })
})
