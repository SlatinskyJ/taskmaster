import { expect, test, type Page } from '@playwright/test'
import { FEATURE_KEYS } from '../src/lib/features'
import { cs } from '../src/lib/strings'
import { bottomBar, logout, passwordLogin } from './helpers'

// Funkce on Správa (#296, spec §6): the admin turns a launch switch on or off after a confirm.
// Its own server on the `launch` seed, which turns every switch off; the tests run in order and
// the flips stay.

test.use({ viewport: { width: 360, height: 800 } })

const t = cs.admin.features
const card = (page: Page) => page.getByRole('region', { name: t.title })
const toggle = (page: Page, name: string) => card(page).getByRole('switch', { name, exact: true })

async function openSprava(page: Page) {
  await passwordLogin(page, 'admin')
  await expect(page).toHaveURL(/\/sprava$/)
}

async function flip(page: Page, name: string, confirm: string) {
  await toggle(page, name).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: confirm, exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

test('admin turns Zapsat on; a taker gets the tab', async ({ page }) => {
  await openSprava(page)
  await expect(card(page).getByRole('switch')).toHaveCount(FEATURE_KEYS.length)
  for (const s of await card(page).getByRole('switch').all()) {
    await expect(s).toHaveAttribute('aria-checked', 'false')
  }
  const zapsat = toggle(page, t.names.log.name)

  // Zrušit changes nothing.
  await zapsat.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(t.turnOnTitle(t.names.log.name))).toBeVisible()
  await page.screenshot({ path: 'test-results/switches-dialog-360.png', animations: 'disabled' })
  await dialog.getByRole('button', { name: cs.admin.cancel }).click()
  await expect(dialog).toHaveCount(0)
  await expect(zapsat).toHaveAttribute('aria-checked', 'false')

  // On, without a reload; still on after one.
  await flip(page, t.names.log.name, t.confirmOn)
  await expect(page.getByText(t.done(t.names.log.name, true))).toBeVisible()
  await expect(zapsat).toHaveAttribute('aria-checked', 'true')
  await page.reload()
  await expect(zapsat).toHaveAttribute('aria-checked', 'true')
  await page.screenshot({ path: 'test-results/switches-card-360.png', fullPage: true })

  // Off, and on again.
  await flip(page, t.names.log.name, t.confirmOff)
  await expect(zapsat).toHaveAttribute('aria-checked', 'false')
  await page.reload()
  await expect(zapsat).toHaveAttribute('aria-checked', 'false')
  await flip(page, t.names.log.name, t.confirmOn)
  await expect(zapsat).toHaveAttribute('aria-checked', 'true')

  await logout(page)
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  await expect(bottomBar(page).getByRole('link', { name: cs.nav.log })).toBeVisible()
})

test('turning Plán týdne off warns about the 15 minutes', async ({ page }) => {
  await openSprava(page)
  const plan = toggle(page, t.names.weekPlan.name)
  await toggle(page, t.names.weekPlan.name).click()
  await expect(page.getByRole('dialog')).not.toContainText(t.weekPlanOff)
  await page.getByRole('dialog').getByRole('button', { name: t.confirmOn, exact: true }).click()
  await expect(plan).toHaveAttribute('aria-checked', 'true')

  await plan.click()
  await expect(page.getByRole('dialog')).toContainText(t.weekPlanOff)
  await page.getByRole('dialog').getByRole('button', { name: cs.admin.cancel }).click()
  await expect(plan).toHaveAttribute('aria-checked', 'true')
})

test("a giver can't set a switch", async ({ page, browser }) => {
  await openSprava(page)
  const call = page.waitForRequest((r) => r.url().includes('/_serverFn/') && r.method() === 'POST')
  await flip(page, t.names.descriptions.name, t.confirmOn)
  const sent = await call
  await flip(page, t.names.descriptions.name, t.confirmOff)
  await expect(toggle(page, t.names.descriptions.name)).toHaveAttribute('aria-checked', 'false')

  // Táta replays the admin's call (turn Popisy on) with his own session.
  const tata = await browser.newPage({ baseURL: new URL(sent.url()).origin })
  await passwordLogin(tata, 'tata')
  await expect(tata).toHaveURL(/\/$/)
  const origin = new URL(sent.url()).origin
  const res = await tata.request.post(sent.url(), {
    headers: {
      'content-type': sent.headers()['content-type'] ?? '',
      Origin: origin,
      'Sec-Fetch-Site': 'same-origin',
    },
    data: sent.postData() ?? '',
  })
  expect(res.status()).toBe(403)
  await tata.close()

  await page.reload()
  await expect(toggle(page, t.names.descriptions.name)).toHaveAttribute('aria-checked', 'false')
})

test("the admin's own app sees the switch at once", async ({ page }) => {
  await openSprava(page)
  await flip(page, t.names.passwordChange.name, t.confirmOn)
  await page.getByRole('link', { name: cs.profile.open }).click()
  await expect(page).toHaveURL(/\/profil$/)
  await expect(page.getByRole('button', { name: cs.profile.passwordRow })).toBeVisible()
})
