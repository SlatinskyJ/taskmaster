import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { logout, passwordLogin } from './helpers'

// Saying no on an agreed chore's price change (#232) on the `chorechange` seed, at 360 px:
// "Umýt koupelnu" runs at 8; Starší bids 10 and Mladší 11, no parents' offer. `bidRefusals` is on.

test.use({ viewport: { width: 360, height: 800 } })

// Match the bid words, not the number alone: the row time holds digits too.
const threadRow = (page: Page, text: RegExp) =>
  page
    .getByRole('region', { name: cs.templatePrice.history })
    .getByRole('listitem')
    .filter({ hasText: text })

test('Starší says Nechci and may not send 10 again; no turn-down until Táta offers, then his 9 stays', async ({
  page,
}) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/sablona/1')
  await expect(page.getByRole('heading', { name: 'Umýt koupelnu' })).toBeVisible()
  await page.getByRole('button', { name: cs.bids.withdraw, exact: true }).click()
  await expect(page.getByText(cs.bids.toast.withdrawn, { exact: true })).toBeVisible()
  await expect(threadRow(page, /chce 10(?!\d)/)).toContainText(cs.bids.closed)
  // Historie ceny is the task Historie's chat bubbles (#289): the time shows only after a tap.
  const bubble = threadRow(page, /chce 10(?!\d)/).getByRole('button')
  const time = page.locator(`#${(await bubble.getAttribute('aria-controls')) ?? ''}`)
  await expect(time).toBeHidden()
  await bubble.click()
  await expect(time).toHaveText(/\d{1,2}\. \d{1,2}\. \d{2}:\d{2}/)
  await bubble.click()
  await expect(time).toBeHidden()
  await expect(page.getByRole('button', { name: cs.bids.withdraw, exact: true })).toHaveCount(0)
  // The stepper still shows his withdrawn 10: the same number waits for the parents' move.
  await expect(page.getByRole('status').filter({ hasText: /^10$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: cs.bids.send, exact: true })).toBeDisabled()
  await expect(page.getByText(cs.bids.sameAgainHint)).toBeVisible()
  await logout(page)

  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/sablona/1')
  await expect(page.getByRole('heading', { name: 'Umýt koupelnu' })).toBeVisible()
  // No parents' offer yet: nothing to turn down to (Jakub 2026-11-26).
  const turnDown = page.getByRole('button', { name: cs.bids.turnDown, exact: true })
  await expect(turnDown).toHaveCount(0)
  // Táta offers 9; now he may turn the bids down and his 9 stays.
  await page.getByRole('button', { name: cs.tasks.more }).click()
  await page.getByRole('button', { name: cs.bids.send, exact: true }).click()
  await expect(page.getByText(cs.bids.toast.sent, { exact: true })).toBeVisible()
  await expect(page.getByText(cs.bids.turnDownChangeHint(8, 9))).toBeVisible()
  await turnDown.click()
  await expect(page.getByText(cs.bids.toast.turnedDown, { exact: true })).toBeVisible()
  await expect(threadRow(page, /chce 11(?!\d)/)).toContainText(cs.bids.closed)
  await expect(page.getByRole('button', { name: /^Přijmout/ })).toHaveCount(0)
  await expect(turnDown).toHaveCount(0)
})
