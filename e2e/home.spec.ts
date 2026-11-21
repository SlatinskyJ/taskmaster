import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// Taker Domů (#40) on the demo seed, through the built server: the points card comes from
// getPointsFn and the real database, and Hotovo on an open task needs no reservation.

test.use({ viewport: { width: 360, height: 800 } })

const bar = (page: Page) => page.locator('[data-slot="points-bar"]').first()

test('taker sees his points and marks an open task done', async ({ page }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  await expect(bar(page)).toHaveAttribute('aria-label', /^40 bodů potvrzeno, 12 čeká/)
  await expect(page.getByText('Do spodní hranice chybí 10 bodů.')).toBeVisible()

  // Nothing floats on first load; the "+5" shows where Hotovo was tapped.
  await expect(page.locator('.animate-float-up')).toHaveCount(0)
  const row = page.getByRole('listitem').filter({ hasText: 'Umýt okna v obýváku i v ložnici' })
  await row.getByRole('button', { name: cs.work.done, exact: true }).click()
  await expect(page.getByText(cs.work.toast.pending)).toBeVisible()
  await expect(page.locator('.animate-float-up', { hasText: '+5' })).toBeVisible()
  await expect(bar(page)).toHaveAttribute('aria-label', /^40 bodů potvrzeno, 17 čeká/)
})

test('the brother’s points are not on his Domů', async ({ page }) => {
  await passwordLogin(page, 'mladsi')
  await expect(page).toHaveURL(/\/$/)
  await expect(bar(page)).toHaveAttribute('aria-label', /^55 bodů potvrzeno, 0 čeká/)
  await expect(page.getByText('Do horní hranice chybí 45 bodů.')).toBeVisible()
  await expect(page.locator('[data-slot="points-bar"]')).toHaveCount(1)
})
