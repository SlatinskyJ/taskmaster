import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import Database from 'better-sqlite3'
import { cs } from '../src/lib/strings'
import { logout, passwordLogin } from './helpers'

// Passkeys off (no WEBAUTHN_RP_ID), as on every preview: everything looks as before #29,
// except that passkeys made while they were on can still be seen and removed in Profil.

/** A passkey left from a time passkeys were on (it can't be made with them off). */
function addOldPasskey(username: string) {
  const dir = process.env.TM_E2E_OFF_DATA_DIR
  if (!dir) throw new Error('TM_E2E_OFF_DATA_DIR not set (playwright.config.ts)')
  const db = new Database(join(dir, 'taskmaster.db'))
  try {
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as {
      id: number
    }
    db.prepare(
      `INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports,
         user_handle, device_kind, backed_up, created_at, last_used_at)
       VALUES (?, 'e2e-old', ?, 0, NULL, 'e2e-handle', 'iphone', 1, '2026-11-01T10:00:00.000Z', NULL)`,
    ).run(user.id, Buffer.from([1]))
  } finally {
    db.close()
  }
}

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

  // An old passkey stays listed and removable, but nothing new can be added.
  addOldPasskey('tata')
  await page.reload()
  await expect(page.getByText(cs.passkeys.section)).toBeVisible()
  await expect(page.getByText(cs.passkeys.device.iphone)).toBeVisible()
  await expect(page.getByRole('button', { name: cs.passkeys.addHere })).toHaveCount(0)
  await page.getByRole('button', { name: cs.passkeys.remove, exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: cs.passkeys.remove }).click()
  await expect(page.getByText(cs.passkeys.removed)).toBeVisible()
  await expect(page.getByText(cs.passkeys.section)).toHaveCount(0)

  await logout(page)
  await passwordLogin(page, 'admin')
  await expect(page).toHaveURL(/\/sprava$/)
  await expect(page.getByText('Táta')).toBeVisible()
  await expect(page.getByText(/klíč/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: cs.passkeys.admin.removeAll })).toHaveCount(0)
})
