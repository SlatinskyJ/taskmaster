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

  // Typed key by key, as on a phone: Return on name and login moves on and sends nothing.
  const name = field(cs.admin.displayName)
  await name.pressSequentially('Babička')
  await expect(name).toHaveValue('Babička')
  await expect(name).toBeFocused()
  await name.press('Enter')
  await expect(field(cs.admin.username)).toBeFocused()
  await field(cs.admin.username).pressSequentially('babicka')
  await field(cs.admin.username).press('Enter')
  await expect(field(cs.admin.password)).toBeFocused()
  await field(cs.admin.password).pressSequentially('babicka123')
  // Every field is filled now, yet Return on the name still only moves on: the sheet stays.
  await name.focus()
  await name.press('Enter')
  await expect(field(cs.admin.username)).toBeFocused()
  // A save would answer within this time and close the sheet with Přidáno.
  await page.waitForTimeout(1500)
  await expect(sheet).toBeVisible()
  await expect(page.getByText(cs.admin.added, { exact: true })).toHaveCount(0)
  // Return on the password saves.
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
