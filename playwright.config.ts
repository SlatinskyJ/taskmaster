import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Browser tests against the built server (`pnpm build` first). Two servers on fresh, empty
// data folders seeded with the demo family: one with passkeys on (localhost), one with them
// off, as on every preview. Locally, point PW_CHROMIUM_PATH at a Chromium if Playwright's own
// is not installed.

const ON = 3100
const OFF = 3101

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
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'retain-on-failure', locale: 'cs-CZ' },
  projects: [
    {
      name: 'on',
      testMatch: 'passkeys.spec.ts',
      use: { ...chromium, baseURL: `http://localhost:${String(ON)}` },
    },
    {
      name: 'off',
      testMatch: 'passkeys-off.spec.ts',
      use: { ...chromium, baseURL: `http://localhost:${String(OFF)}` },
    },
  ],
  webServer: [
    server(ON, {
      WEBAUTHN_RP_ID: 'localhost',
      WEBAUTHN_ORIGIN: `http://localhost:${String(ON)}`,
    }),
    server(OFF, {}),
  ],
})
