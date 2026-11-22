import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import Database from 'better-sqlite3'
import { cs } from '../src/lib/strings'
import { bottomBar, passwordLogin } from './helpers'

// The launch switches as the migration seeds them (all off), read from the real database by
// the app shell: a brother has no bar, a parent's bar is Domů / Úkoly, and Nový úkol has no
// Jednorázový / Opakovaný toggle yet still creates a one-time task. The demo seed turns every
// switch on (previews show the whole app), so this file sets them back to the migration's
// values first and turns them on again after, for the specs that share this server.

/** Sets every launch switch in the off server's database. */
function setSwitches(enabled: boolean) {
  const dir = process.env.TM_E2E_OFF_DATA_DIR
  if (!dir) throw new Error('TM_E2E_OFF_DATA_DIR not set (playwright.config.ts)')
  const db = new Database(join(dir, 'taskmaster.db'))
  try {
    db.prepare('UPDATE feature_flags SET enabled = ?').run(enabled ? 1 : 0)
  } finally {
    db.close()
  }
}

test.use({ viewport: { width: 360, height: 800 } })
test.beforeAll(() => {
  setSwitches(false)
})
test.afterAll(() => {
  setSwitches(true)
})

test('a brother has no bottom bar at launch', async ({ page }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText(cs.home.waiting)).toBeVisible()
  await expect(bottomBar(page)).toHaveCount(0)
})

test('a parent’s bar is Domů / Úkoly, and Nový úkol creates a one-time task', async ({ page }) => {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await expect(bottomBar(page).getByRole('link')).toHaveText([cs.nav.home, cs.nav.tasks])

  await page.goto('/ukoly/novy')
  await expect(page.getByLabel(cs.tasks.title)).toBeVisible()
  await expect(page.getByRole('button', { name: cs.templates.kindRecurring })).toHaveCount(0)
  await expect(page.getByRole('button', { name: cs.templates.kindOneTime })).toHaveCount(0)

  await page.getByLabel(cs.tasks.title).fill('Zamést terasu po bouřce')
  await page.getByRole('button', { name: cs.tasks.propose, exact: true }).click()
  await expect(page.getByText(cs.tasks.created, { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/ukoly$/)
  await expect(page.getByText('Zamést terasu po bouřce')).toBeVisible()
})
