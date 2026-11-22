import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// Recurring chores made by a person (#38) on the demo data, at 360 px: Starší logs a chore on
// Zapsat and his pending points go up; Táta's "+ Teď" adds an open copy to Úkoly and he approves
// the log; with the copy on the board, Zapsat shows the tile as taken (Jakub 2026-11-22).

test.use({ viewport: { width: 360, height: 800 } })

const bar = (page: Page) => page.locator('[data-slot="points-bar"]').first()

async function switchTo(page: Page, username: string) {
  await page.goto('/profil')
  await page.getByRole('button', { name: cs.login.logout }).click()
  await passwordLogin(page, username)
  await expect(page).toHaveURL(/\/$/)
}

test('Zapsat, + Teď, approve, then the tile is taken', async ({ page }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  await expect(bar(page)).toHaveAttribute('aria-label', /^260 bodů potvrzeno, 14 čeká/)
  await page.goto('/zapsat')
  // The school bag is already on the board in the demo data.
  await expect(
    page.getByRole('button', { name: cs.log.tileOnBoardLabel('Nachystat tašku do školy') }),
  ).toBeDisabled()
  await page.getByRole('button', { name: cs.log.tileLabel('Vyndat myčku', 3) }).click()
  await expect(page.getByText(cs.log.confirmBody('Vyndat myčku', 3))).toBeVisible()
  // The demo week starts at boot, so no earlier time is open yet: no "Kdy?" pills.
  await expect(page.getByText(cs.log.when.label)).toHaveCount(0)
  await page.getByRole('button', { name: cs.log.confirm, exact: true }).click()
  await expect(page.getByText(cs.log.toast)).toBeVisible()
  await page.goto('/')
  await expect(bar(page)).toHaveAttribute('aria-label', /^260 bodů potvrzeno, 17 čeká/)

  await switchTo(page, 'tata')
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
  await page.goto('/')
  const mine = page
    .getByRole('listitem')
    .filter({ hasText: 'Vyndat myčku' })
    .filter({ hasText: 'Starší' })
  await mine.getByRole('button', { name: cs.work.approve }).click()
  await expect(page.locator('[data-slot="points-bar"]').nth(0)).toHaveAttribute(
    'aria-label',
    /^263 bodů potvrzeno, 14 čeká/,
  )

  await switchTo(page, 'starsi')
  await page.goto('/zapsat')
  await expect(
    page.getByRole('button', { name: cs.log.tileOnBoardLabel('Vyndat myčku') }),
  ).toBeDisabled()
})
