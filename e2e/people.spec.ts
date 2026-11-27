import { expect, test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { logout, passwordLogin } from './helpers'

// Správa, Nový člověk (#286): the admin adds a person with Return alone, field by field; the
// sheet closes, the person is on the list and can log in. Own server: the person stays.

test('the admin adds a person from Správa with the Return key', async ({ page }) => {
  await passwordLogin(page, 'admin')
  await expect(page).toHaveURL(/\/sprava$/)
  await page.getByRole('button', { name: cs.admin.add }).click()
  const sheet = page.getByRole('dialog', { name: cs.admin.addTitle })
  const field = (name: string) => sheet.getByRole('textbox', { name: new RegExp(`^${name}`) })

  // Return on name and login moves on; it sends nothing yet.
  await field(cs.admin.displayName).fill('Babička')
  await field(cs.admin.displayName).press('Enter')
  await expect(field(cs.admin.username)).toBeFocused()
  await field(cs.admin.username).fill('babicka')
  await field(cs.admin.username).press('Enter')
  await expect(field(cs.admin.password)).toBeFocused()
  await expect(sheet).toBeVisible()
  // Return on the password saves.
  await field(cs.admin.password).fill('babicka123')
  await field(cs.admin.password).press('Enter')

  await expect(page.getByText(cs.admin.added, { exact: true })).toBeVisible()
  await expect(sheet).toHaveCount(0)
  const row = page.getByRole('button', { name: cs.admin.editPerson('Babička') })
  await expect(row).toContainText('babicka')
  await expect(row).toContainText(cs.roles.taker)

  await logout(page)
  await page.getByLabel(cs.login.username).fill('babicka')
  await page.getByLabel(cs.login.password).fill('babicka123')
  await page.getByRole('button', { name: cs.login.submit, exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
})
