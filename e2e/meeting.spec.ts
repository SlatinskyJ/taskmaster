import { expect, test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// The weekly meeting (#44) on the demo week: Táta approves the four waiting chores (one of them
// Mladší's self-logged dishwasher, #38), settles the week (Starší 174 with last week's 8
// carried, Mladší 108) and lands on the plan step.

test('Táta runs the meeting: approve, settle, plan', async ({ page }) => {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/schuzka')
  const m = cs.meeting

  for (const title of [
    'Vytřít podlahu v kuchyni',
    'Zalít kytky',
    'Vynést tříděný',
    'Vyndat myčku',
  ]) {
    const row = page.locator('li', { hasText: title })
    await row.getByRole('button', { name: cs.work.approve }).click()
    await expect(page.getByText(title)).toHaveCount(0)
  }
  await expect(page.getByText(m.allClear)).toBeVisible()
  await page.getByRole('button', { name: m.next }).click()

  const starsi = page.locator('[data-taker]', { hasText: 'Starší' })
  await expect(starsi).toContainText('174')
  await expect(starsi).toContainText(m.level.upper)
  await page.getByRole('button', { name: m.confirm }).click()
  await page.getByRole('button', { name: m.confirmYes, exact: true }).click()

  await expect(page.getByText(m.startWith)).toBeVisible()
  await expect(page.locator('[data-start]', { hasText: 'Starší' })).toHaveText(/^Starší\s*74$/)
  await expect(page.locator('[data-start]', { hasText: 'Mladší' })).toHaveText(/^Mladší\s*8$/)
  await expect(page.getByRole('link', { name: m.end })).toBeVisible()
})
