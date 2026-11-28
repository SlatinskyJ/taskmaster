import { expect, test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { logout, passwordLogin } from './helpers'

// Souhlasím on a proposed chore's Domů row (#244) on the `chores` seed, `choreBidding` on:
// "Vynést kompost" (/sablona/1), Táta's chore at 10 with no bids, waits for one brother's yes.
// The row shows Jiná cena next to Souhlasím; Souhlasím alone agrees the chore at 10.

test.use({ viewport: { width: 360, height: 800 } })

test('Anička taps Souhlasím on Vynést kompost and the chore runs at 10', async ({ page }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  const waiting = page.locator('section').filter({ has: page.getByText(cs.home.waiting) })
  const compost = waiting.getByRole('listitem').filter({ hasText: 'Vynést kompost' })
  await expect(compost.getByRole('link', { name: cs.bids.otherPriceShort })).toBeVisible()
  await compost.getByRole('button', { name: cs.tasks.approve, exact: true }).click()
  await expect(page.getByText(cs.tasks.approved, { exact: true })).toBeVisible()
  await expect(waiting.getByText('Vynést kompost')).toHaveCount(0)
  await logout(page)

  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/sablona/1')
  await expect(page.getByRole('heading', { name: 'Vynést kompost' })).toBeVisible()
  await expect(page.getByText(cs.templatePrice.now(10))).toBeVisible()
  await expect(page.getByText(cs.state.proposed, { exact: true })).toHaveCount(0)
})
