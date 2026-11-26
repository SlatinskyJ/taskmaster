import { test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'
import { expectAboveKeyboard, openKeyboard, PHONE_BROWSER, useKeyboard } from './keyboard'

// Změnit heslo (#210) with the phone keyboard open (e2e/keyboard.ts), on the `password` seed
// (switch on): each field stays visible while typing (Jakub, 2026-11-24). Read-only.

const { keyboard, ...viewport } = PHONE_BROWSER

test.use({ viewport, isMobile: true, hasTouch: true })

test('Profil, Změnit heslo: the sheet moves up, each field stays visible', async ({ page }) => {
  await useKeyboard(page, keyboard)
  await passwordLogin(page, 'starsi')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await page.goto('/profil')
  await page.getByRole('button', { name: cs.profile.passwordRow }).click()
  const sheet = page.getByRole('dialog', { name: cs.profile.passwordTitle })
  for (const label of [
    cs.profile.currentPassword,
    cs.profile.newPassword,
    cs.profile.newPasswordAgain,
  ]) {
    const field = sheet.getByLabel(label, { exact: true })
    await openKeyboard(page, field)
    await expectAboveKeyboard(page, field)
  }
})
