import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { logout, passwordLogin } from './helpers'

// Reopened bidding (#212) on the `rebid` seed: "Zamést chodník před domem" free at 6, never
// reopened; "Vynést staré věci na půdu" agreed at 12 after Starší's bid 14 (an earlier round),
// now in a round with Mladší's bid 15. Switches `reopenBidding` and `bidRefusals` on.
const FREE = 'Zamést chodník před domem'
const ROUND = 'Vynést staré věci na půdu'

/** Logs in and opens the task page from Domů's row link. */
async function openTask(page: Page, who: 'starsi' | 'mladsi' | 'tata', title: string) {
  await passwordLogin(page, who)
  const row = page.getByRole('listitem').filter({ hasText: title }).first()
  await expect(row).toBeVisible()
  await row.getByRole('link').first().click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

const thread = (page: Page) => page.getByRole('region', { name: cs.bids.thread })
// Match the bid words, not the number alone: the row time (e.g. 16:15) holds digits too.
const threadRow = (page: Page, text: RegExp) =>
  thread(page).getByRole('listitem').filter({ hasText: text })

test('Starší reopens a free task and Táta accepts his bid', async ({ page }) => {
  await openTask(page, 'starsi', FREE)
  await page.getByRole('button', { name: cs.rebid.reopen, exact: true }).click()
  await expect(page.getByText(cs.rebid.toast.reopened, { exact: true })).toBeVisible()
  await expect(page.getByText(cs.state.negotiating).first()).toBeVisible()
  await expect(thread(page)).toContainText(cs.rebid.noEntries)
  await expect(page.getByText(cs.taskPrice.oldStays(6), { exact: true })).toBeVisible()

  await page.getByRole('button', { name: cs.tasks.more }).click()
  await page.getByRole('button', { name: cs.tasks.more }).click()
  await page.getByRole('button', { name: cs.bids.send, exact: true }).click()
  await expect(page.getByText(cs.bids.toast.sent, { exact: true })).toBeVisible()
  await expect(threadRow(page, /chceš? 8(?!\d)/)).toBeVisible()
  await logout(page)

  await openTask(page, 'tata', FREE)
  await page.getByRole('button', { name: cs.bids.acceptBid(8, 'Starší'), exact: true }).click()
  await expect(page.getByText(cs.bids.toast.agreed, { exact: true })).toBeVisible()
  await expect(page.getByText(`${cs.work.reservedBy} Starší`)).toBeVisible()
})

test("a brother's Domů shows the round", async ({ page }) => {
  await passwordLogin(page, 'mladsi')
  const row = page.getByRole('listitem').filter({ hasText: ROUND }).first()
  await expect(row).toContainText(cs.state.negotiating)
})

test('the round shows only its own bids, and Táta turns them down', async ({ page }) => {
  await openTask(page, 'tata', ROUND)
  await expect(threadRow(page, /chce 15(?!\d)/)).toHaveCount(1)
  await expect(threadRow(page, /chce 14(?!\d)/)).toHaveCount(0)
  await page.getByRole('button', { name: cs.bids.turnDown, exact: true }).click()
  await expect(page.getByText(cs.bids.toast.turnedDown, { exact: true })).toBeVisible()
  await expect(page.getByText(cs.state.open, { exact: true }).first()).toBeVisible()
  await expect(page.getByText(cs.taskPrice.oldStays(12), { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: cs.rebid.reopen, exact: true })).toBeVisible()
})
