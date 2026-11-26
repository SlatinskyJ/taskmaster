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
  // Its own server: Nechci and the turn-down close bids for good (#208).
  { name: 'bids', spec: 'bid-refusals.spec.ts', seed: 'bids' },
  // Its own server: it approves and rejects for good (#206).
  { name: 'approve', spec: 'approve.spec.ts', seed: 'approve' },
  // Its own server: a round changes the task for good (#212).
  { name: 'rebid', spec: 'rebidding.spec.ts', seed: 'rebid' },
  // Its own server: it reserves and agrees for good (#205).
  { name: 'rows', spec: 'rows.spec.ts', seed: 'rows' },
  { name: 'week', spec: 'week.spec.ts', seed: 'week' },
  // Its own server: settling changes the week for good.
  { name: 'meeting', spec: 'meeting.spec.ts', seed: 'week' },
  // Its own server: the save changes the default week for good.
  { name: 'default-week', spec: 'default-week.spec.ts', seed: 'week' },
  // Its own server: it adds instances and approves a log.
  { name: 'recurring', spec: 'recurring.spec.ts', seed: 'recurring' },
  // Its own server: bids, Nechci and the turn-down change the chores for good (#209).
  { name: 'chores', spec: 'chore-bidding.spec.ts', seed: 'chores' },
  // Its own server: the scheduled and expired rows of #39.
  { name: 'scheduler', spec: 'scheduler.spec.ts', seed: 'scheduler' },
  // Its own server: the proposals change for good.
  { name: 'proposals', spec: 'proposals.spec.ts', seed: 'proposals' },
  // Its own server: it opens a dispute for good.
  { name: 'disputes', spec: 'disputes.spec.ts', seed: 'disputes' },
  // Its own server: it writes fixes for good.
  { name: 'corrections', spec: 'corrections.spec.ts', seed: 'corrections' },
  // Forms with the simulated phone keyboard open (e2e/keyboard.ts). Read-only: dialogs are
  // opened, never sent. `tasks` has a task Táta gave, for Zrušit úkol?.
  { name: 'keyboard', spec: 'keyboard.spec.ts', seed: 'tasks' },
  // The fix sheet with the keyboard open (#48): it needs the disputes switch and open disputes.
  // Read-only: sheets are opened, never sent.
  { name: 'keyboard-fix', spec: 'keyboard-fix.spec.ts', seed: 'corrections' },
  // Its own server: the password changes for good (#210).
  { name: 'password', spec: 'password.spec.ts', seed: 'password' },
  // Změnit heslo with the keyboard open (#210): it needs the passwordChange switch. Read-only.
  { name: 'keyboard-password', spec: 'keyboard-password.spec.ts', seed: 'password' },
  // The reject reason (#206) with the keyboard open. Read-only: forms are opened, never sent.
  { name: 'keyboard-approve', spec: 'keyboard-approve.spec.ts', seed: 'approve' },
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
