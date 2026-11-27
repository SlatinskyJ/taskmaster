import { defineConfig, devices } from '@playwright/test'
import { suiteServers } from './e2e/suites'

// Browser tests against the built server (`pnpm build` first). One server per suite
// (e2e/suites.ts), each on a fresh, empty data folder with its own seed (#183), all started at
// once. Locally, point PW_CHROMIUM_PATH at a Chromium if Playwright's own is not installed.

// Chromium draws `<input type="time">` in its own interface language, not the page's `locale`:
// without these, screenshots show "11:59 PM" where a Czech phone shows 23:59 (#221). Linux reads
// LANG/LANGUAGE, other systems the --lang switch.
const czech = {
  args: ['--lang=cs-CZ'],
  env: { ...process.env, LANG: 'cs_CZ.UTF-8', LANGUAGE: 'cs' },
}

const chromium = {
  ...devices['Desktop Chrome'],
  launchOptions: process.env.PW_CHROMIUM_PATH
    ? { ...czech, executablePath: process.env.PW_CHROMIUM_PATH }
    : czech,
}

const servers = suiteServers()

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: { trace: 'retain-on-failure', locale: 'cs-CZ' },
  projects: servers.map(({ suite, port }) => ({
    name: suite.name,
    testMatch: suite.spec,
    use: { ...chromium, baseURL: `http://localhost:${String(port)}` },
  })),
  webServer: servers.map(({ port, env }) => ({
    command: 'node .output/server/index.mjs',
    url: `http://localhost:${String(port)}/api/health`,
    reuseExistingServer: false,
    stdout: 'pipe' as const,
    timeout: 60_000,
    env,
  })),
})
