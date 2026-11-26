import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// Rows open their page (#205), on the `rows` seed: the negotiation, points, templates and
// instances pieces with the openRows switch on. suites.test.ts pins the ids: task 9 "Umýt okna v
// obýváku i v ložnici" (open), task 3 "Vyluxovat celý obývák a chodbu" (reserved by Starší),
// task 12 a copy of chore 3, chore 1 "Vynést koše" (proposed by Táta).

test.use({ viewport: { width: 360, height: 800 } })
// One database for the whole file: each test continues from the one before.
test.describe.configure({ mode: 'serial' })

const FREE = 'Umýt okna v obýváku i v ložnici'
const MINE = 'Vyluxovat celý obývák a chodbu'
const BINS = 'Vynést koše'

async function login(page: Page, who: string) {
  await passwordLogin(page, who)
  await expect(page).toHaveURL(/\/$/)
}

const back = (page: Page) => page.getByRole('link', { name: cs.profile.back })

test('a brother taps a free task’s name, then reserves it on its page', async ({ page }) => {
  await login(page, 'starsi')
  await page.getByRole('link', { name: FREE, exact: true }).click()
  await expect(page).toHaveURL(/\/ukol\/9$/)
  await expect(page.getByRole('heading', { name: FREE })).toBeVisible()
  await expect(page.getByText(cs.work.reserveHint)).toBeVisible()
  await page.getByRole('button', { name: cs.work.reserve, exact: true }).click()
  await expect(page.locator('[data-sonner-toast]').getByText(cs.work.toast.reserved)).toBeVisible()
  await expect(page.getByRole('button', { name: cs.work.done, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: cs.work.release, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: cs.work.reserve, exact: true })).toHaveCount(0)
})

test('Hotovo on a linked row runs Hotovo and stays on Domů', async ({ page }) => {
  await login(page, 'starsi')
  await page
    .getByRole('listitem')
    .filter({ hasText: MINE })
    .getByRole('button', { name: cs.work.done, exact: true })
    .click()
  await expect(page.getByText(cs.work.toast.pending)).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})

test('a brother opens the proposed chore, agrees, and ← goes back to Domů', async ({ page }) => {
  await login(page, 'starsi')
  await page.getByRole('link', { name: BINS, exact: true }).click()
  await expect(page).toHaveURL(/\/sablona\/1$/)
  await expect(page.getByRole('heading', { name: BINS })).toBeVisible()
  await expect(page.getByText(cs.state.proposed, { exact: true })).toBeVisible()
  await expect(page.getByText(cs.templatePrice.proposed(4))).toBeVisible()
  await expect(page.getByText('Čeká se na: tebe nebo Mladší')).toBeVisible()
  await page.getByRole('button', { name: cs.tasks.approve, exact: true }).click()
  await expect(page.getByText(cs.templatePrice.now(4))).toBeVisible()
  await expect(page.getByText(cs.state.proposed, { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: cs.tasks.approve, exact: true })).toHaveCount(0)
  await back(page).click()
  await expect(page).toHaveURL(/\/$/)
  const waiting = page.locator('section').filter({ has: page.getByText(cs.home.waiting) })
  await expect(waiting.getByText(BINS)).toHaveCount(0)
})

test('a parent opens rows on Úkoly; ← goes back there, a cold page’s ← to Domů', async ({
  page,
}) => {
  await login(page, 'tata')
  await page.goto('/ukoly')
  const done = page
    .locator('section')
    .filter({ has: page.getByText(`${cs.state.confirmed} (`) })
    .first()
  await done.getByRole('link').first().click()
  await expect(page).toHaveURL(/\/ukol\/\d+$/)
  await back(page).click()
  await expect(page).toHaveURL(/\/ukoly$/)

  // Its copies share the name; the chore's row is the one to /sablona.
  await page.locator('a[href="/sablona/2"]', { hasText: 'Vyndat myčku' }).click()
  await expect(page).toHaveURL(/\/sablona\/2$/)
  await back(page).click()
  await expect(page).toHaveURL(/\/ukoly$/)

  await page.goto('/ukol/3')
  await back(page).click()
  await expect(page).toHaveURL(/\/$/)
})

test('a chore’s copy links to its chore', async ({ page }) => {
  await login(page, 'tata')
  await page.goto('/ukol/12')
  await page.getByRole('link', { name: cs.tasks.chorePageLink }).click()
  await expect(page).toHaveURL(/\/sablona\/3$/)
})

test('Týden: a row of this week opens its task', async ({ page }) => {
  await login(page, 'tata')
  await page.goto('/tyden')
  await page.locator('[data-slot="task-row"] a').first().click()
  await expect(page).toHaveURL(/\/ukol\/\d+$/)
})
