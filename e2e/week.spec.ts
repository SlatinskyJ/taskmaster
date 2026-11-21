import { expect, test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// Týden (#45) on the demo data: last week is settled (Starší 108 → 8 carried), this week runs.
// A taker sees only himself, through the real loader and server function; a giver sees both.

test('Starší sees his own week and history, nobody else', async ({ page }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/tyden')
  await expect(page.getByRole('heading', { name: cs.week.myTitle })).toBeVisible()
  const main = page.locator('main')
  await expect(main).toContainText('120 ✔')
  await expect(main).toContainText('Z minula převedeno 8 bodů')
  await expect(main).toContainText('Zalít kytky')
  await expect(main).not.toContainText('Mladší')
  await expect(main).not.toContainText('47')
  await expect(main).not.toContainText('Vynést sklo a plasty do kontejneru')

  await page.getByRole('tab', { name: cs.week.history }).click()
  await expect(main).toContainText('Celkem 108 · odečteno 100 · převod 8')
  await expect(main).not.toContainText('Mladší')
  await expect(main).not.toContainText('Celkem 50')
})

test("Táta sees every boy, and Mladší's rejected chore", async ({ page }) => {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/tyden')
  const main = page.locator('main')
  await expect(main).toContainText('Starší')
  await expect(main).toContainText('Mladší')
  await expect(main).toContainText('Vynést sklo a plasty do kontejneru')
  await expect(main).toContainText('vynes ho prosím')
  await page.getByRole('tab', { name: cs.week.history }).click()
  await expect(main).toContainText('Celkem 50 · odečteno 50 · převod 0')
})
