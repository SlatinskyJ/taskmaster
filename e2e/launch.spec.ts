import { expect, test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { bottomBar, passwordLogin } from './helpers'

// Every launch switch off, as at the family launch, read from the real database by
// the app shell: a brother has no bar, a parent's bar is Domů / Úkoly, and Nový úkol has no
// Jednorázový / Opakovaný toggle yet still creates a one-time task. Its own server on the
// `launch` seed (#183), which turns every switch off, while previews' `demo` seed turns all on.

test.use({ viewport: { width: 360, height: 800 } })

test('a brother has no bottom bar at launch', async ({ page }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText(cs.home.waiting)).toBeVisible()
  await expect(bottomBar(page)).toHaveCount(0)
})

test('a parent’s bar is Domů / Úkoly, and Nový úkol creates a one-time task', async ({ page }) => {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await expect(bottomBar(page).getByRole('link')).toHaveText([cs.nav.home, cs.nav.tasks])

  await page.goto('/ukoly/novy')
  await expect(page.getByLabel(cs.tasks.title)).toBeVisible()
  await expect(page.getByRole('button', { name: cs.templates.kindRecurring })).toHaveCount(0)
  await expect(page.getByRole('button', { name: cs.templates.kindOneTime })).toHaveCount(0)

  await page.getByLabel(cs.tasks.title).fill('Zamést terasu po bouřce')
  await page.getByRole('button', { name: cs.tasks.propose, exact: true }).click()
  await expect(page.getByText(cs.tasks.created, { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/ukoly$/)
  await expect(page.getByText('Zamést terasu po bouřce')).toBeVisible()
})

test('reopening bidding stays hidden with its switch off (#212)', async ({ page }) => {
  await passwordLogin(page, 'starsi')
  // Domů: the free row's name is no link (it links only with the switch on).
  const row = page.getByRole('listitem').filter({ hasText: 'Umýt okna v obýváku i v ložnici' })
  await expect(row).toBeVisible()
  await expect(row.getByRole('link')).toHaveCount(0)
  // The page itself: task 9 of the `launch` seed (negotiation's 3 tasks, then points' 6).
  await page.goto('/ukol/9')
  await expect(page.getByRole('heading', { name: 'Umýt okna v obýváku i v ložnici' })).toBeVisible()
  await expect(page.getByRole('button', { name: cs.taskPrice.change })).toBeVisible()
  await expect(page.getByRole('button', { name: cs.rebid.reopen })).toHaveCount(0)
})

test('a parent’s Úkoly row has no task link with the switch off (#212)', async ({ page }) => {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await bottomBar(page).getByRole('link', { name: cs.nav.tasks }).click()
  const parentRow = page
    .getByRole('listitem')
    .filter({ hasText: 'Umýt okna v obýváku i v ložnici' })
  await expect(parentRow).toBeVisible()
  await expect(parentRow.getByRole('link')).toHaveCount(0)
})

test('the live change stream answers 404 with its switch off (#299)', async ({ page }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  expect((await page.request.get('/api/live?tab=x')).status()).toBe(404)
})
