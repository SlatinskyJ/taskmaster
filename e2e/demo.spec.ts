import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { TASK_TITLE_MAX } from '../src/lib/taskLimits'
import { logout, PASSWORD, passwordLogin } from './helpers'

// The public demo (TASKMASTER_ENV=demo, #327) through the real entry points: links are removed
// from what a visitor sends, the locked actions change nothing, and the dev pages work. Its own
// server on the `demo` seed (every switch on). No screen changes yet (#328): a lock refusal
// shows the screen's usual failure.

test.use({ viewport: { width: 360, height: 800 } })
test.describe.configure({ mode: 'serial' })

/** Not in the demo seed, so its row is the only one. */
const TITLE = 'Zalít kytky na balkóně'

async function login(page: Page, who: string) {
  await passwordLogin(page, who)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}

async function newTask(page: Page, title: string, description?: string) {
  await page.goto('/ukoly/novy')
  await page.getByLabel(cs.tasks.title).fill(title)
  if (description !== undefined) await page.getByLabel(cs.description.newField).fill(description)
  await page.getByRole('button', { name: cs.tasks.propose, exact: true }).click()
}

test('links are removed from a new task: the title and text keep the rest', async ({ page }) => {
  await login(page, 'tata')
  await newTask(page, `${TITLE} www.evil.cz`, 'viz https://evil.cz')
  await expect(page.getByText(cs.tasks.created, { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/ukoly$/)
  const row = page.getByRole('listitem').filter({ has: page.getByText(TITLE, { exact: true }) })
  await expect(row).toBeVisible()
  await row.getByRole('link').first().click()
  await expect(page.getByRole('heading', { name: TITLE, exact: true })).toBeVisible()
  await expect(page.locator('[data-slot="description"]')).toContainText('viz')
  await expect(page.locator('body')).not.toContainText('evil.cz')
})

test('a title that is only a link is refused as an empty title', async ({ page }) => {
  await login(page, 'tata')
  await newTask(page, 'https://evil.cz')
  await expect(page.getByText(cs.tasks.errors.invalidTitle(TASK_TITLE_MAX))).toBeVisible()
  await expect(page).toHaveURL(/\/ukoly\/novy$/)
})

test('the admin cannot flip a launch switch', async ({ page }) => {
  const t = cs.admin.features
  await login(page, 'admin')
  await expect(page).toHaveURL(/\/sprava$/)
  const card = page.getByRole('region', { name: t.title })
  const zapsat = card.getByRole('switch', { name: t.names.log.name, exact: true })
  await expect(zapsat).toHaveAttribute('aria-checked', 'true')
  await zapsat.click()
  await page.getByRole('dialog').getByRole('button', { name: t.confirmOff, exact: true }).click()
  await expect(page.getByText(t.failed)).toBeVisible()
  await page.reload()
  await expect(zapsat).toHaveAttribute('aria-checked', 'true')
})

test('Anička cannot change her password; the old one still logs in', async ({ page }) => {
  await login(page, 'starsi')
  await page.goto('/profil')
  await page.getByRole('button', { name: cs.profile.passwordRow }).click()
  const sheet = page.getByRole('dialog', { name: cs.profile.passwordTitle })
  await sheet.getByLabel(cs.profile.currentPassword, { exact: true }).fill(PASSWORD)
  await sheet.getByLabel(cs.profile.newPassword, { exact: true }).fill('noveheslo1')
  await sheet.getByLabel(cs.profile.newPasswordAgain, { exact: true }).fill('noveheslo1')
  await sheet.getByRole('button', { name: cs.profile.passwordSubmit }).click()
  await expect(sheet.getByRole('alert')).toBeVisible()
  await expect(page.getByText(cs.profile.passwordChangedOthers)).toHaveCount(0)
  await logout(page)
  await login(page, 'starsi')
  await expect(page).not.toHaveURL(/\/login/)
})

test('/dev/multi loads and a frame logs in as Béďa', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await page.goto('/dev/multi')
  await expect(page.locator('[data-device]')).toHaveCount(3)
  const mladsi = page.locator('[data-device]').nth(2).frameLocator('iframe')
  await expect(mladsi.getByRole('heading', { name: `${cs.home.greeting}, Béďa!` })).toBeVisible()
})
