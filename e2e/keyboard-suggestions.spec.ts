import { expect, test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'
import { expectAboveKeyboard, openKeyboard, PHONE_BROWSER, useKeyboard } from './keyboard'

// The suggestion sheets (#247) with the phone keyboard open (e2e/keyboard.ts), on the
// `suggestions` seed: each field stays visible while typing (CLAUDE.md). Read-only: the sheets
// are opened, never sent.

const t = cs.suggestions
const { keyboard, ...viewport } = PHONE_BROWSER

test.use({ viewport, isMobile: true, hasTouch: true })

test('Profil, Navrhnout zlepšení: Název and Popis stay visible', async ({ page }) => {
  await useKeyboard(page, keyboard)
  await passwordLogin(page, 'starsi')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await page.goto('/profil')
  await page.getByRole('button', { name: t.row }).click()
  const sheet = page.getByRole('dialog', { name: t.sheetTitle })
  // Nothing is focused on open (an iPhone brings up no keyboard for a focus outside a tap):
  // the person taps Název once the sheet is in place, and it stays above the keyboard.
  const title = sheet.getByLabel(t.titleLabel, { exact: true })
  await expect(title).not.toBeFocused()
  await title.tap()
  await expect(title).toBeFocused()
  await expect(page.locator('#__keyboard')).toBeAttached()
  await expectAboveKeyboard(page, title)
  for (const label of [t.descriptionLabel, t.titleLabel]) {
    const field = sheet.getByLabel(label, { exact: true })
    await openKeyboard(page, field)
    await expectAboveKeyboard(page, field)
  }
})

test('Správa, Poslat na GitHub: Název issue and Text issue stay visible', async ({ page }) => {
  await useKeyboard(page, keyboard)
  await passwordLogin(page, 'admin')
  await expect(page).toHaveURL(/\/sprava$/)
  await page
    .locator('[data-suggestion]')
    .filter({ hasText: 'Tmavý režim i na obrazovce Týden' })
    .getByRole('button', { name: t.sendRow })
    .click()
  const sheet = page.getByRole('dialog', { name: t.previewTitle })
  for (const label of [t.issueTitleLabel, t.issueBodyLabel]) {
    const field = sheet.getByLabel(label, { exact: true })
    await openKeyboard(page, field)
    await expectAboveKeyboard(page, field)
  }
})
