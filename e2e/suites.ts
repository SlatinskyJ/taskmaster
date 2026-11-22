import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SeedName } from '../src/server/demo/seeds'

// The browser-test suites (#183): one row per spec file, each with its own server, its own
// empty data folder and its own seed (src/server/demo/seeds.ts), so no suite's data or clicks
// change another's numbers. A new spec file gets a new row, never a second file in a row
// (tests/e2e-suites.test.ts checks). Launch switches come from the seed, not from here.

export interface Suite {
  name: string
  spec: string
  seed: SeedName
  env?: Record<string, string>
}

const FIRST_PORT = 3100

export const portOf = (index: number) => FIRST_PORT + index

export const SUITES: readonly Suite[] = [
  { name: 'on', spec: 'passkeys.spec.ts', seed: 'family' },
  // Passkeys off, as on every preview. Its spec adds a passkey row to this server's database
  // directly; the env var keeps the folder the same when Playwright loads this file again.
  {
    name: 'off',
    spec: 'passkeys-off.spec.ts',
    seed: 'family',
    env: { DATA_DIR: (process.env.TM_E2E_OFF_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'tm-e2e-'))) },
  },
  { name: 'home', spec: 'home.spec.ts', seed: 'home' },
  { name: 'launch', spec: 'launch.spec.ts', seed: 'launch' },
  { name: 'tasks', spec: 'task-page.spec.ts', seed: 'tasks' },
  { name: 'week', spec: 'week.spec.ts', seed: 'week' },
  // Its own server: settling changes the week for good.
  { name: 'meeting', spec: 'meeting.spec.ts', seed: 'week' },
  // Its own server: the save changes the default week for good.
  { name: 'default-week', spec: 'default-week.spec.ts', seed: 'week' },
  // Its own server: it adds instances and approves a log.
  { name: 'recurring', spec: 'recurring.spec.ts', seed: 'recurring' },
  // Its own server: the scheduled and expired rows of #39.
  { name: 'scheduler', spec: 'scheduler.spec.ts', seed: 'scheduler' },
]

/** Passkeys on (localhost) for the `on` suite only, at its own port. */
function extraEnv(suite: Suite, port: number): Record<string, string> {
  if (suite.name !== 'on') return {}
  return { WEBAUTHN_RP_ID: 'localhost', WEBAUTHN_ORIGIN: `http://localhost:${String(port)}` }
}

/** One server per suite: its port and environment. */
export function suiteServers(suites: readonly Suite[] = SUITES) {
  return suites.map((suite, i) => {
    const port = portOf(i)
    return {
      suite,
      port,
      env: {
        PORT: String(port),
        TASKMASTER_ENV: 'preview',
        TASKMASTER_SEED: suite.seed,
        DATA_DIR: mkdtempSync(join(tmpdir(), 'tm-e2e-')),
        ...extraEnv(suite, port),
        ...suite.env,
      },
    }
  })
}
