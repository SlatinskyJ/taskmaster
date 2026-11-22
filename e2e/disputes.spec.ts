import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// Rozporovat (#46) on the `disputes` seed: Starší's "Vysát auto" is already disputed, Mladší's
// past-week settlement was disputed and kept by the admin. Serial: the second test reads the
// dispute the first one opens.
test.describe.configure({ mode: 'serial' })

const row = (page: Page, title: string) =>
  page.locator('[data-slot="task-row"]').filter({ hasText: title })

test('Starší disputes a confirmed chore: Sporné, the chore stays Hotovo', async ({ page }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/tyden')
  await expect(row(page, 'Vysát auto')).toContainText(cs.disputes.waiting)

  const bath = row(page, 'Uklidit koupelnu')
  await bath
    .getByRole('button', {
      name: cs.disputes.actionFor(cs.disputes.what.completion, 'Uklidit koupelnu'),
    })
    .click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText('Uklidit koupelnu · 40 bodů')
  const send = sheet.getByRole('button', { name: cs.disputes.send })
  await expect(send).toBeDisabled()
  await sheet.getByLabel(cs.disputes.reasonLabel).fill('Drhnul jsem i spáry, to je víc.')
  await send.click()
  await expect(page.getByText(cs.disputes.sent)).toBeVisible()
  await expect(bath).toContainText(cs.disputes.waiting)
  await expect(bath).toContainText(cs.state.confirmed)
})

test('Táta sees Sporné on both of Starší’s disputed chores', async ({ page }) => {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/tyden')
  await expect(row(page, 'Vysát auto')).toContainText(cs.disputes.waiting)
  await expect(row(page, 'Uklidit koupelnu')).toContainText(cs.disputes.waiting)
})

test('Mladší reads the admin’s answer on his settled week and in Rozporováno', async ({ page }) => {
  await passwordLogin(page, 'mladsi')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/tyden')
  await page.getByRole('tab', { name: cs.week.history }).click()
  const main = page.locator('main')
  const kept = cs.disputes.kept('Body sedí, zkontroloval jsem to s tátou.')
  await expect(main.locator('[data-record]')).toContainText(kept)
  await expect(main.locator('[data-dispute]')).toContainText(kept)
  await expect(main.getByText(cs.disputes.list)).toBeVisible()
})
