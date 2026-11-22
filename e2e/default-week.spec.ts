import { expect, test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { logout, passwordLogin } from './helpers'

// Výchozí týden on Správa (#47): the admin changes the default week; the saved values stay after
// a reload, and the running week keeps its levels (spec §5.8). Own server: the save is stored.

test('admin changes the default week; the running week keeps 50 / 100', async ({ page }) => {
  await passwordLogin(page, 'admin')
  await expect(page).toHaveURL(/\/sprava$/)
  const card = page.getByRole('region', { name: cs.admin.defaults.title })
  await expect(card).toContainText('7 dní')
  await expect(card.getByRole('combobox', { name: cs.admin.defaults.weekday })).toContainText(
    'neděle',
  )
  await expect(card.getByLabel(cs.admin.defaults.time)).toHaveValue('23:59')
  const lower = card.getByRole('slider', { name: cs.meeting.level.lower })
  const upper = card.getByRole('slider', { name: cs.meeting.level.upper })
  await expect(lower).toHaveAttribute('aria-valuenow', '50')
  await expect(upper).toHaveAttribute('aria-valuenow', '100')
  const save = card.getByRole('button', { name: cs.admin.save })
  await expect(save).toBeDisabled()

  // Lower 50 → 60 with the arrow keys on the dial, upper 100 → 120.
  await lower.focus()
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight')
  await upper.focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('PageUp')
  await expect(lower).toHaveAttribute('aria-valuenow', '60')
  await expect(upper).toHaveAttribute('aria-valuenow', '120')
  await save.click()
  await expect(page.getByText(cs.admin.saved)).toBeVisible()

  await page.reload()
  await expect(lower).toHaveAttribute('aria-valuenow', '60')
  await expect(upper).toHaveAttribute('aria-valuenow', '120')
  await logout(page)

  // The running week never changes: Táta's Týden still shows 50 / 100.
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/tyden')
  const main = page.locator('main')
  await expect(main).toContainText(`${cs.points.lowerTick} 50`)
  await expect(main).toContainText(`${cs.points.upperTick} 100`)
  await expect(main).not.toContainText(`${cs.points.lowerTick} 60`)
})
