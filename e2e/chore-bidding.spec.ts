import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { logout, passwordLogin } from './helpers'

// Bidding on a proposed chore (#209) on the `chores` seed, at 360 px: Táta proposed
// "Vynést kompost" at 10 with no bids and "Zalít kytky" at 4, where Starší bids 6 and Mladší 7.
// The `choreBidding` switch is on.

test.use({ viewport: { width: 360, height: 800 } })

const row = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ hasText: title }).first()

/** Logs in and opens the chore's page from its Domů row link. */
async function openFromHome(page: Page, who: 'starsi' | 'mladsi' | 'tata', title: string) {
  await passwordLogin(page, who)
  await expect(page).toHaveURL(/\/$/)
  await row(page, title).getByRole('link').first().click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

// Match the bid words, not the number alone: the row time holds digits too.
const threadRow = (page: Page, text: RegExp) =>
  page
    .getByRole('region', { name: cs.templatePrice.history })
    .getByRole('listitem')
    .filter({ hasText: text })

test('Mladší bids 11 on Vynést kompost, Táta accepts it and the chore runs at 11', async ({
  page,
}) => {
  await passwordLogin(page, 'mladsi')
  await expect(page).toHaveURL(/\/$/)
  const chore = row(page, 'Vynést kompost')
  await expect(chore.getByRole('button', { name: cs.tasks.approve })).toBeVisible()
  await chore.getByRole('link', { name: cs.bids.otherPriceShort }).click()
  await expect(page.getByRole('heading', { name: 'Vynést kompost' })).toBeVisible()
  await expect(page.getByText(cs.templatePrice.proposedNow(10))).toBeVisible()
  await page.getByRole('button', { name: cs.tasks.more, exact: true }).click()
  await page.getByRole('button', { name: cs.bids.send, exact: true }).click()
  await expect(page.getByText(cs.bids.toast.sent, { exact: true })).toBeVisible()
  await expect(page.getByText(`${cs.bids.yourBid} 11`)).toBeVisible()
  await page.goto('/')
  await expect(row(page, 'Vynést kompost').getByRole('link', { name: cs.bids.open })).toBeVisible()
  await logout(page)

  await openFromHome(page, 'tata', 'Vynést kompost')
  await page
    .getByRole('button', { name: cs.templatePrice.acceptBid(11, 'Mladší'), exact: true })
    .click()
  await expect(page.getByText(cs.bids.toast.agreed, { exact: true })).toBeVisible()
  await expect(page.getByText(cs.templatePrice.now(11))).toBeVisible()
  for (const name of [/^Přijmout/, new RegExp(`^${cs.bids.turnDown}$`), /^Souhlasím$/]) {
    await expect(page.getByRole('button', { name })).toHaveCount(0)
  }
})

test('Starší says Nechci on Zalít kytky, then Táta turns the bids down', async ({ page }) => {
  await openFromHome(page, 'starsi', 'Zalít kytky')
  await page.getByRole('button', { name: cs.bids.withdraw, exact: true }).click()
  await expect(page.getByText(cs.bids.toast.withdrawn, { exact: true })).toBeVisible()
  await expect(page.getByText(`${cs.bids.yourBid} 6`)).toHaveCount(0)
  await logout(page)

  await openFromHome(page, 'tata', 'Zalít kytky')
  await page.getByRole('button', { name: cs.bids.turnDown, exact: true }).click()
  await expect(page.getByText(cs.bids.toast.turnedDown, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: cs.bids.turnDown, exact: true })).toHaveCount(0)
  await expect(page.getByText(cs.templatePrice.proposedNow(4))).toBeVisible()
  await expect(threadRow(page, /chce 6(?!\d)/)).toContainText(cs.bids.closed)
  await expect(threadRow(page, /chce 7(?!\d)/)).toContainText(cs.bids.closed)
})

// "Zalít kytky" is now proposed at 4 with its bids closed (the test above).
test("Táta's counter at a bid is refused once a brother agreed the chore meanwhile (#243)", async ({
  browser,
}) => {
  const viewport = { width: 360, height: 800 }
  const open = async () => (await browser.newContext({ viewport })).newPage()
  const [mladsi, tata, starsi] = [await open(), await open(), await open()]

  await openFromHome(mladsi, 'mladsi', 'Zalít kytky')
  await expect(mladsi.getByText(cs.templatePrice.proposedNow(4))).toBeVisible()
  for (let i = 0; i < 2; i++) {
    await mladsi.getByRole('button', { name: cs.tasks.more, exact: true }).click()
  }
  await mladsi.getByRole('button', { name: cs.bids.send, exact: true }).click()
  await expect(mladsi.getByText(cs.bids.toast.sent, { exact: true })).toBeVisible()
  await expect(mladsi.getByText(`${cs.bids.yourBid} 6`)).toBeVisible()

  // Táta's page shows Mladší's bid 6; he steps to it but does not tap yet.
  await openFromHome(tata, 'tata', 'Zalít kytky')
  await expect(threadRow(tata, /chce 6(?!\d)/).filter({ hasText: 'Mladší' })).toHaveCount(1)
  const offer = tata.getByRole('region', { name: cs.bids.newOffer })
  for (let i = 0; i < 2; i++) {
    await offer.getByRole('button', { name: cs.tasks.more, exact: true }).click()
  }
  // The counter under the stepper, at exactly the bid (not the yes button above it).
  const send = offer.getByRole('button', {
    name: cs.templatePrice.acceptBid(6, 'Mladší'),
    exact: true,
  })
  await expect(send).toBeVisible()

  // Meanwhile Starší agrees at the offer on his Domů: the chore runs at 4.
  await passwordLogin(starsi, 'starsi')
  await expect(starsi).toHaveURL(/\/$/)
  await row(starsi, 'Zalít kytky').getByRole('button', { name: cs.tasks.approve }).click()
  await expect(starsi.getByText(cs.tasks.approved, { exact: true })).toBeVisible()

  await send.click()
  await expect(tata.getByText(cs.tasks.errors.offerChanged)).toBeVisible()
  await tata.reload()
  await expect(tata.getByText(cs.templatePrice.now(4))).toBeVisible()
  await expect(tata.getByRole('button', { name: /^Přijmout/ })).toHaveCount(0)
  await expect(threadRow(tata, /nabízí 6(?!\d)/)).toHaveCount(0)
})
