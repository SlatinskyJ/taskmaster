import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Browser tests against the built server (`pnpm build` first). Five servers on fresh, empty
// data folders seeded with the demo family: one with passkeys on (localhost), one with them
// off, as on every preview, one for the task page flows (#36), one for the weekly meeting, one for Týden and one for recurring chores. Locally, point PW_CHROMIUM_PATH at a Chromium if Playwright's own
// is not installed.

const ON = 3100
const OFF = 3101
/** Task page flows (#36): own server and data folder, so they never touch the others' data. */
const TASKS = 3102
/** The weekly meeting (#44): its own server, as settling changes the demo week for good. */
const MEETING = 3103
/** Týden (#45): its own server, so other specs' approvals never change its numbers. */
const WEEK = 3104
/** Recurring chores made by a person (#38): its own server, as it adds instances. */
const RECURRING = 3105

// The off server's data folder, shared with its spec (which adds a passkey row directly).
// Playwright loads this file again in each worker; the env var keeps the folder the same.
process.env.TM_E2E_OFF_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'tm-e2e-'))

function server(port: number, env: Record<string, string>) {
  return {
    command: 'node .output/server/index.mjs',
    url: `http://localhost:${String(port)}/api/health`,
    reuseExistingServer: false,
    stdout: 'pipe' as const,
    timeout: 60_000,
    env: {
      PORT: String(port),
      TASKMASTER_ENV: 'preview',
      DATA_DIR: mkdtempSync(join(tmpdir(), 'tm-e2e-')),
      ...env,
    },
  }
}

const chromium = {
  ...devices['Desktop Chrome'],
  launchOptions: process.env.PW_CHROMIUM_PATH
    ? { executablePath: process.env.PW_CHROMIUM_PATH }
    : {},
}

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: { trace: 'retain-on-failure', locale: 'cs-CZ' },
  projects: [
    {
      name: 'on',
      testMatch: 'passkeys.spec.ts',
      use: { ...chromium, baseURL: `http://localhost:${String(ON)}` },
    },
    {
      name: 'off',
      testMatch: ['passkeys-off.spec.ts', 'home.spec.ts', 'launch.spec.ts'],
      use: { ...chromium, baseURL: `http://localhost:${String(OFF)}` },
    },
    {
      name: 'week',
      testMatch: 'week.spec.ts',
      use: { ...chromium, baseURL: `http://localhost:${String(WEEK)}` },
    },
    {
      name: 'tasks',
      testMatch: 'task-page.spec.ts',
      use: { ...chromium, baseURL: `http://localhost:${String(TASKS)}` },
    },
    {
      name: 'recurring',
      testMatch: 'recurring.spec.ts',
      use: { ...chromium, baseURL: `http://localhost:${String(RECURRING)}` },
    },
    {
      name: 'meeting',
      testMatch: 'meeting.spec.ts',
      use: { ...chromium, baseURL: `http://localhost:${String(MEETING)}` },
    },
  ],
  webServer: [
    server(ON, {
      WEBAUTHN_RP_ID: 'localhost',
      WEBAUTHN_ORIGIN: `http://localhost:${String(ON)}`,
    }),
    server(OFF, { DATA_DIR: process.env.TM_E2E_OFF_DATA_DIR }),
    server(TASKS, {}),
    server(MEETING, {}),
    server(WEEK, {}),
    server(RECURRING, {}),
  ],
})
