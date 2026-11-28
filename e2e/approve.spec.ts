import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// Approve done work from the task page and Úkoly (#206), on the `approve` seed: the `home` tasks
// with the approveAnywhere switch on. Task 6 is "Vytřít podlahu v kuchyni" (done by Anička,
// waiting), task 3 "Vyluxovat celý obývák a chodbu" (reserved by Anička); suites.test.ts pins the
// ids. Rows link to their page only with #205, so the pages are opened by URL.

test.use({ viewport: { width: 360, height: 800 } })
// One database for the whole file: each test continues from the one before.
test.describe.configure({ mode: 'serial' })

const LONG = 'Vyluxovat celý obývák a chodbu'
const section = (page: Page, label: string) =>
  page
    .locator('section')
    .filter({ has: page.getByText(label, { exact: false }) })
    .first()

test('a parent’s Domů starts with Ke schválení', async ({ page }) => {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  const labels = page.locator('main section > :first-child')
  await expect(labels.first()).toHaveText(`${cs.work.toApprove} (1)`)
})

test('the brother marks his task done; its page shows him no Schválit', async ({ page }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  await page
    .getByRole('listitem')
    .filter({ hasText: LONG })
    .getByRole('button', { name: cs.work.done, exact: true })
    .click()
  await expect(page.getByText(cs.work.toast.pending)).toBeVisible()
  await page.goto('/ukol/3')
  await expect(page.getByRole('heading', { name: LONG })).toBeVisible()
  await expect(page.getByRole('button', { name: cs.work.approve })).toHaveCount(0)
  await expect(page.getByRole('button', { name: cs.work.reject })).toHaveCount(0)
})

test('a parent approves from the task page', async ({ page }) => {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText(`${cs.work.toApprove} (2)`)).toBeVisible()
  await page.goto('/ukol/6')
  await page.getByRole('button', { name: cs.work.approve, exact: true }).click()
  await expect(page.getByText(cs.work.toast.approved)).toBeVisible()
  await expect(page.getByRole('button', { name: cs.work.approve })).toHaveCount(0)
  await expect(page.getByText(cs.state.confirmed, { exact: true }).first()).toBeVisible()

  await page.goto('/ukoly')
  await expect(page.getByText(`${cs.state.pending} (1)`)).toBeVisible()
  const done = section(page, `${cs.state.confirmed} (`)
  await expect(done.getByText('Vytřít podlahu v kuchyni')).toBeVisible()
})

test('on Úkoly ✕ opens the reason form, Zpět closes it and sends nothing', async ({ page }) => {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/ukoly')
  const row = page.getByRole('listitem').filter({ hasText: LONG })
  await row.getByRole('button', { name: cs.work.reject }).click()
  await expect(row.getByLabel(cs.work.rejectReason)).toBeFocused()
  await row.getByRole('button', { name: cs.work.back }).click()
  await expect(row.getByLabel(cs.work.rejectReason)).toHaveCount(0)
  await expect(row.getByRole('button', { name: cs.work.reject })).toBeFocused()
  await expect(page.getByText(`${cs.state.pending} (1)`)).toBeVisible()
})

test('a parent rejects from the task page with a reason: back to his reservation', async ({
  page,
}) => {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/ukol/3')
  await page.getByRole('button', { name: cs.work.reject, exact: true }).click()
  await page.getByLabel(cs.work.rejectReason).fill('Ještě chodba')
  await page.getByRole('button', { name: cs.work.reject, exact: true }).click()
  await expect(page.getByText(cs.work.toast.rejected)).toBeVisible()
  await expect(page.getByRole('button', { name: cs.work.approve })).toHaveCount(0)
  await expect(page.getByText(cs.state.reserved, { exact: true }).first()).toBeVisible()
  await expect(page.getByText('„Ještě chodba“')).toBeVisible()
})
