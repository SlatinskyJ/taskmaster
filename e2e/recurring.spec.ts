import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// Recurring chores made by a person (#38) on the demo data, at 360 px: Táta's "+ Teď" adds an
// open instance to Úkoly; Starší logs a chore on Zapsat, his pending points go up; Táta approves.

test.use({ viewport: { width: 360, height: 800 } })

const bar = (page: Page) => page.locator('[data-slot="points-bar"]').first()

test('+ Teď, Zapsat, approve', async ({ page }) => {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/ukoly')
  const open = page.getByRole('listitem').filter({ hasText: 'Vyndat myčku' })
  const before = await open.count()
  const template = page
    .getByRole('region', { name: cs.templates.section })
    .getByRole('listitem')
    .filter({ hasText: 'Vyndat myčku' })
  await template.getByRole('button', { name: cs.instances.now }).click()
  await expect(page.getByText(cs.instances.toast.created)).toBeVisible()
  await expect(open).toHaveCount(before + 1)

  await page.goto('/profil')
  await page.getByRole('button', { name: cs.login.logout }).click()
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  await expect(bar(page)).toHaveAttribute('aria-label', /^260 bodů potvrzeno, 14 čeká/)
  await page.goto('/zapsat')
  await page.getByRole('button', { name: cs.log.tileLabel('Vyndat myčku', 3) }).click()
  await expect(page.getByText(cs.log.confirmBody('Vyndat myčku', 3))).toBeVisible()
  await page.getByRole('button', { name: cs.log.confirm, exact: true }).click()
  await expect(page.getByText(cs.log.toast)).toBeVisible()
  await page.goto('/')
  await expect(bar(page)).toHaveAttribute('aria-label', /^260 bodů potvrzeno, 17 čeká/)

  await page.goto('/profil')
  await page.getByRole('button', { name: cs.login.logout }).click()
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  const mine = page
    .getByRole('listitem')
    .filter({ hasText: 'Vyndat myčku' })
    .filter({ hasText: 'Starší' })
  await mine.getByRole('button', { name: cs.work.approve }).click()
  await expect(page.locator('[data-slot="points-bar"]').nth(0)).toHaveAttribute(
    'aria-label',
    /^263 bodů potvrzeno, 14 čeká/,
  )
})
