import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { logout, passwordLogin } from './helpers'

// Descriptions (#207) through the real routes and server functions, on the `descriptions` seed
// (src/server/demo/suites.test.ts pins the ids): task 1 "Uklidit kolárnu" proposed with a text,
// task 2 "Odnést krabice do sklepa" open with Táta's new text waiting for Mladší.

test.use({ viewport: { width: 360, height: 800 } })
// One database for the whole file: each test continues from the one before.
test.describe.configure({ mode: 'serial' })

const LONG = 'Vyluxovat celý obývák a chodbu'
const BOXES = 'Odnést krabice do sklepa'
const OLD = 'Všechny krabice z chodby.'
const NEW = 'Prázdné složit a dát k popelnicím.'

async function login(page: Page, who: string) {
  await passwordLogin(page, who)
  await expect(page).toHaveURL(/\/$/)
}

const history = (page: Page) => page.getByRole('region', { name: cs.history.title })
const block = (page: Page) => page.locator('[data-slot="description"]')
const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').getByText(text, { exact: true }).last()

test('Táta gives a task with a text; Starší reads it before he agrees', async ({ page }) => {
  await login(page, 'tata')
  await page.goto('/ukoly/novy')
  await page.getByLabel(cs.tasks.title).fill(LONG)
  await page.getByLabel(cs.description.newField).fill('Pod gaučem taky.\nVysavač je v komoře.')
  await page.getByRole('button', { name: cs.tasks.propose, exact: true }).click()
  await expect(page.getByText(cs.tasks.created, { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/ukoly$/)
  // A long name on Úkoly stays whole at 360 px (#176): two lines, nothing cut.
  const name = page.getByText(LONG, { exact: true })
  await expect(name).toBeVisible()
  expect(await name.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true)
  await logout(page)

  await login(page, 'starsi')
  const row = page.getByRole('listitem').filter({ hasText: LONG })
  await expect(row.getByRole('img', { name: cs.description.hasIcon })).toBeVisible()
  await expect(row.getByRole('button', { name: cs.tasks.approve, exact: true })).toHaveCount(0)
  await row.getByRole('link', { name: cs.description.readAndAgree }).click()
  await expect(page.getByRole('heading', { name: LONG })).toBeVisible()
  await expect(block(page)).toContainText('Pod gaučem taky.')
  await expect(block(page)).toContainText('Vysavač je v komoře.')
  await page.getByRole('button', { name: cs.tasks.approve, exact: true }).click()
  await expect(page.getByRole('button', { name: cs.tasks.approve, exact: true })).toHaveCount(0)
})

test('Mladší OKs Táta’s new text from Domů; the text changes and the history says so', async ({
  page,
}) => {
  await login(page, 'mladsi')
  const row = page.getByRole('listitem').filter({ hasText: cs.description.homeRow })
  await expect(row).toContainText(BOXES)
  await row.getByRole('link', { name: cs.bids.answer }).click()
  await expect(page).toHaveURL(/\/ukol\/2$/)
  await expect(page.getByText(cs.description.waitingTitle)).toBeVisible()
  // What changes, before he says yes (Jakub 2026-11-26): the new line is marked as added.
  const diff = page.locator('[data-slot="description-diff"]')
  await expect(diff.locator('ins')).toContainText(NEW)
  await expect(diff.getByText(cs.description.diffHint)).toBeVisible()
  await page.getByRole('button', { name: cs.description.agree, exact: true }).click()
  await expect(toast(page, cs.description.toast.agreed)).toBeVisible()
  await expect(page.getByText(cs.description.waitingTitle)).toHaveCount(0)
  await expect(block(page)).toContainText(OLD)
  await expect(block(page)).toContainText(NEW)
  await expect(history(page)).toContainText(cs.history.descriptionApproved)
})

test('Táta edits the open task and takes it back; then Mladší says no to the next', async ({
  page,
}) => {
  await login(page, 'tata')
  await page.goto('/ukol/2')
  await page.getByRole('button', { name: cs.description.edit, exact: true }).click()
  await page.getByRole('dialog').getByLabel(cs.description.field).fill('Jen ty malé.')
  await page.getByRole('dialog').getByRole('button', { name: cs.description.save }).click()
  await expect(toast(page, cs.description.toast.waiting)).toBeVisible()
  await page.getByRole('button', { name: cs.description.takeBack, exact: true }).click()
  await expect(toast(page, cs.description.toast.withdrawn)).toBeVisible()
  await expect(page.getByText(cs.description.waitingTitle)).toHaveCount(0)
  await expect(block(page)).toContainText(NEW)
  await expect(history(page)).toContainText(cs.history.descriptionWithdrawn)

  await page.getByRole('button', { name: cs.description.edit, exact: true }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByText(cs.description.waitWarn)).toBeVisible()
  await sheet.getByLabel(cs.description.field).fill('Jen ty velké.')
  await sheet.getByRole('button', { name: cs.description.save, exact: true }).click()
  await expect(toast(page, cs.description.toast.waiting)).toBeVisible()
  await expect(page.getByText(cs.description.waitingTitle)).toBeVisible()
  await expect(block(page)).toContainText(NEW)
  await logout(page)

  await login(page, 'mladsi')
  await page.goto('/ukol/2')
  await page.getByRole('button', { name: cs.description.decline, exact: true }).click()
  await expect(toast(page, cs.description.toast.declined)).toBeVisible()
  await expect(page.getByText(cs.description.waitingTitle)).toHaveCount(0)
  await expect(block(page)).toContainText(NEW)
  await expect(block(page)).not.toContainText('Jen ty velké.')
  await expect(history(page)).toContainText(cs.history.descriptionDeclined)
})

test('a text changed while Starší reads: his Souhlasím says look again', async ({
  page,
  browser,
}) => {
  await login(page, 'starsi')
  await page.goto('/ukol/1')
  await expect(block(page)).toContainText('Kola pověsit na háky.')

  const tata = await browser.newPage({ viewport: { width: 360, height: 800 } })
  await login(tata, 'tata')
  await tata.goto('/ukol/1')
  await tata.getByRole('button', { name: cs.description.edit, exact: true }).click()
  const sheet = tata.getByRole('dialog')
  await expect(sheet.getByText(cs.description.resetWarn)).toBeVisible()
  await sheet.getByLabel(cs.description.field).fill('Zamést i pod regálem.')
  await sheet.getByRole('button', { name: cs.description.save, exact: true }).click()
  await expect(toast(tata, cs.description.toast.applied)).toBeVisible()
  await tata.close()

  await page.getByRole('button', { name: cs.tasks.approve, exact: true }).click()
  await expect(page.getByText(cs.tasks.errors.offerChanged)).toBeVisible()
})
