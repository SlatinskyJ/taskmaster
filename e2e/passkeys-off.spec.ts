import { expect, test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { logout, passwordLogin } from './helpers'

// Passkeys off (no WEBAUTHN_RP_ID), as on every preview: everything looks as before #29.

test('passkeys off look as today', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel(cs.login.username)).toBeVisible()
  await expect(page.getByRole('button', { name: cs.passkeys.loginButton })).toHaveCount(0)
  await expect(page.getByText(cs.passkeys.hint)).toHaveCount(0)
  await expect(page.getByLabel(cs.login.username)).toHaveAttribute('autocomplete', 'username')

  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)

  await page.goto('/klic')
  await expect(page).toHaveURL(/\/$/)

  await page.goto('/profil')
  await expect(page.getByRole('button', { name: cs.login.logout })).toBeVisible()
  await expect(page.getByText(cs.passkeys.section)).toHaveCount(0)

  await logout(page)
  await passwordLogin(page, 'admin')
  await expect(page).toHaveURL(/\/sprava$/)
  await expect(page.getByText('Táta')).toBeVisible()
  await expect(page.getByText(/klíč/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: cs.passkeys.admin.removeAll })).toHaveCount(0)
})
