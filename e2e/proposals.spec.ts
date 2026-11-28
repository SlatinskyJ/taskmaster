import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { logout, passwordLogin } from './helpers'

/** Logs in and waits for Domů, so the next `goto` carries the session. */
async function login(page: Page, username: string) {
  await passwordLogin(page, username)
  await expect(page).toHaveURL(/\/$/)
}

// Příští týden and Výchozí týden (#43) on seed `proposals`: Anička's next week waits for
// Béďa, Táta's 14-day default week waits for both kids. Serial: each step builds on the last,
// through the real server functions.

const t = cs.proposals
test.describe.configure({ mode: 'serial' })

const periodCard = (page: Page) => page.locator('[data-kind="period"]')
const defaultsCard = (page: Page) => page.locator('[data-kind="defaults"]')

test('Táta withdraws his default week and proposes another', async ({ page }) => {
  await login(page, 'tata')
  await page.goto('/tyden')
  await page.getByRole('link', { name: t.entry.card }).click()
  await expect(page).toHaveURL(/\/tyden\/pristi$/)
  await expect(defaultsCard(page).getByText(t.waiting)).toHaveCount(2)
  await page.getByRole('link', { name: t.defaultsLink }).click()
  await expect(page).toHaveURL(/\/tyden\/vychozi$/)
  await defaultsCard(page).getByRole('button', { name: t.withdraw }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(t.confirm.withdraw.bodyDefaults)
  await dialog.getByRole('button', { name: t.confirm.withdraw.yes }).click()
  await expect(page.getByText(t.done.withdraw)).toBeVisible()
  await page.getByRole('button', { name: cs.admin.defaults.longer }).click()
  await expect(page.locator('main')).toContainText('14 dní')
  await page.getByRole('button', { name: t.proposeAll }).click()
  await expect(page.getByText(t.sent)).toBeVisible()
  await expect(defaultsCard(page)).toContainText(t.proposedBy('Táta'))
  await logout(page)
})

test('Béďa says no to Anička’s next week and proposes a shorter one', async ({ page }) => {
  await login(page, 'mladsi')
  await expect(page.getByText(t.entry.periodRow)).toBeVisible()
  await page.getByRole('link', { name: t.entry.open, exact: true }).first().click()
  await expect(page).toHaveURL(/\/tyden\/pristi$/)
  await expect(periodCard(page)).toContainText(t.proposedBy('Anička'))
  await periodCard(page).getByRole('button', { name: t.reject, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(t.confirm.reject.body)
  await dialog.getByRole('button', { name: t.confirm.reject.yes }).click()
  await expect(page.getByText(t.done.reject)).toBeVisible()
  await page.getByRole('button', { name: t.proposeOther }).click()
  await page.getByRole('button', { name: t.shorter }).click()
  await page.getByRole('button', { name: t.proposeAll }).click()
  await expect(page.getByText(t.sent)).toBeVisible()
  await expect(periodCard(page)).toContainText(t.proposedBy('Béďa'))
  await logout(page)
})

test('Anička and Táta agree: Dohodnuto', async ({ page }) => {
  await login(page, 'starsi')
  await expect(page.getByText(t.entry.periodRow)).toBeVisible()
  await page.getByRole('link', { name: t.entry.open, exact: true }).first().click()
  await periodCard(page).getByRole('button', { name: t.approve, exact: true }).click()
  await expect(page.getByText(t.done.approve)).toBeVisible()
  await logout(page)

  await login(page, 'tata')
  await page.goto('/tyden/pristi')
  await periodCard(page).getByRole('button', { name: t.approve, exact: true }).click()
  await expect(periodCard(page)).toContainText(t.agreedChip)
  await expect(periodCard(page).getByRole('button')).toHaveCount(0)
})
