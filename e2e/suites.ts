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
  // Its own server: Souhlasím makes the proposed chore run for good (#244).
  { name: 'chore-approve', spec: 'chore-approve.spec.ts', seed: 'chores' },
  // Its own server: Nechci and the turn-down change the chore's price change for good (#232).
  { name: 'chorechange', spec: 'chore-change.spec.ts', seed: 'chorechange' },
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
  // The dispute forms (#46, #47) with the keyboard open (#219). Read-only: forms are opened,
  // never sent.
  { name: 'keyboard-disputes', spec: 'keyboard-disputes.spec.ts', seed: 'disputes' },
  // Its own server: the password changes for good (#210).
  { name: 'password', spec: 'password.spec.ts', seed: 'password' },
  // Změnit heslo with the keyboard open (#210): it needs the passwordChange switch. Read-only.
  { name: 'keyboard-password', spec: 'keyboard-password.spec.ts', seed: 'password' },
  // The reject reason (#206) with the keyboard open. Read-only: forms are opened, never sent.
  { name: 'keyboard-approve', spec: 'keyboard-approve.spec.ts', seed: 'approve' },
  // Its own server: it gives, edits and answers descriptions for good (#207).
  { name: 'descriptions', spec: 'descriptions.spec.ts', seed: 'descriptions' },
  // The description fields (#207) with the keyboard open. Read-only: nothing is sent.
  { name: 'keyboard-descriptions', spec: 'keyboard-descriptions.spec.ts', seed: 'descriptions' },
  // Its own server: it suggests, closes and checks the send preview for good (#247).
  { name: 'suggestions', spec: 'suggestions.spec.ts', seed: 'suggestions' },
  // The suggestion sheets (#247) with the keyboard open. Read-only: nothing is sent.
  { name: 'keyboard-suggestions', spec: 'keyboard-suggestions.spec.ts', seed: 'suggestions' },
  // Czech letters in the app's fonts (#246). Read-only.
  { name: 'fonts', spec: 'fonts.spec.ts', seed: 'demo' },
  // Viewer frames (#265) and the CSRF check: logs in and out, so its own server.
  { name: 'frames', spec: 'frames.spec.ts', seed: 'family' },
  // Week chore copies (#257): Domů and Zapsat by the copy's day. Read-only.
  { name: 'weekcopies', spec: 'week-copies.spec.ts', seed: 'weekplan' },
  // The plan table on Týden (#258). Its own server: it reserves, releases and adds an extra copy
  // for good.
  { name: 'week-plan', spec: 'week-plan.spec.ts', seed: 'plantable' },
  // The week plan at Schůzka (#259). Its own server: it settles a week and reserves for good.
  // Its seed's running week is on its last day, so settling works on any weekday with the
  // last-day rule on, and a new week starts.
  { name: 'meeting-plan', spec: 'meeting-plan.spec.ts', seed: 'planmeeting' },
  // The same with live change notices on (#313): no Obnovit, the banner refreshes the plan.
  { name: 'meeting-plan-live', spec: 'meeting-plan-live.spec.ts', seed: 'planmeetinglive' },
  // The multi-user viewer (#265): logs frames in and out and proposes tasks, so its own server.
  // `week`: the boys' Týden tab is on.
  { name: 'multi', spec: 'multi.spec.ts', seed: 'week' },
  // The live change stream's route (#299): read-only, `demo` has the liveChanges switch on.
  { name: 'live', spec: 'live.spec.ts', seed: 'demo' },
  // The live change banner (#299) in three browsers. Its own server: it reserves and releases
  // for good.
  { name: 'live-banner', spec: 'live-banner.spec.ts', seed: 'demo' },
  // The live change banner over the phone keyboard, a sheet and at 360 px (#299), with a
  // scripted stream. Read-only: forms are opened, never sent.
  { name: 'keyboard-live', spec: 'keyboard-live.spec.ts', seed: 'demo' },
  // Profil → Aplikace (#302): a fake install event. Read-only: changes no data.
  { name: 'install', spec: 'install.spec.ts', seed: 'family' },
  // Launch switches in Správa (#296). Its own server: it flips switches for good.
  { name: 'switches', spec: 'switches.spec.ts', seed: 'launch' },
  // The public demo (#327): lock, link removal and dev pages on a demo server. Its own server:
  // it creates tasks for good. The demo needs TRUST_PROXY=1 to boot.
  {
    name: 'demo',
    spec: 'demo.spec.ts',
    seed: 'demo',
    env: { TASKMASTER_ENV: 'demo', TRUST_PROXY: '1' },
  },
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
