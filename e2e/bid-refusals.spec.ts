import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { logout, passwordLogin } from './helpers'

// Saying no in bidding (#208) on the `bids` seed: "Umýt auto", Táta offers 18, Anička bids 25,
// Béďa 22, the `bidRefusals` switch on.
const TASK = 'Umýt auto'

/** Logs in and opens the task page from Domů's row link. */
async function openTask(page: Page, who: 'starsi' | 'mladsi' | 'tata') {
  await passwordLogin(page, who)
  const row = page.getByRole('listitem').filter({ hasText: TASK }).first()
  await expect(row).toBeVisible()
  await row.getByRole('link').first().click()
  await expect(page.getByRole('heading', { name: TASK })).toBeVisible()
}

// Match the bid words, not the number alone: the row time (e.g. 16:22) holds digits too.
const threadRow = (page: Page, text: RegExp) =>
  page.getByRole('region', { name: cs.bids.thread }).getByRole('listitem').filter({ hasText: text })

test("Béďa's Nechci, then Táta turns the bidding down", async ({ page }) => {
  // (a) Béďa says no: only his 22 closes; Anička's 25 stays open.
  await openTask(page, 'mladsi')
  await page.getByRole('button', { name: cs.bids.withdraw, exact: true }).click()
  await expect(page.getByText(cs.bids.toast.withdrawn, { exact: true })).toBeVisible()
  await expect(page.getByText(`${cs.bids.yourBid} 22`)).toHaveCount(0)
  await expect(threadRow(page, /chceš? 22(?!\d)/)).toContainText(cs.bids.closed)
  await expect(threadRow(page, /chceš? 25(?!\d)/)).not.toContainText(cs.bids.closed)
  await logout(page)

  // (b) Táta turns the rest down: still Navrženo at 18, every bid closed.
  await openTask(page, 'tata')
  await page.getByRole('button', { name: cs.bids.turnDown, exact: true }).click()
  await expect(page.getByText(cs.bids.toast.turnedDown, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: cs.bids.turnDown, exact: true })).toHaveCount(0)
  await expect(threadRow(page, /chceš? 25(?!\d)/)).toContainText(cs.bids.closed)
  await expect(page.getByRole('region', { name: cs.history.title })).toContainText(
    cs.history.bidsTurnedDown,
  )
})
