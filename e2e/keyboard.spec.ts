import { test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'
import { expectAboveKeyboard, openKeyboard, PHONE_BROWSER, useKeyboard } from './keyboard'

// Forms with the phone keyboard open (e2e/keyboard.ts). The rule (Jakub, 2026-11-24): the field
// a person types into is visible while they type. The send button may sit under the keyboard
// as long as the page scrolls to it. A form screen adds its case here when it is built.

const { keyboard, ...viewport } = PHONE_BROWSER

test.use({ viewport, isMobile: true, hasTouch: true })

test.beforeEach(async ({ page }) => {
  await useKeyboard(page, keyboard)
})

test('login: each field stays above the keyboard', async ({ page }) => {
  await page.goto('/login')
  for (const label of [cs.login.username, cs.login.password]) {
    const field = page.getByLabel(label, { exact: true })
    await openKeyboard(page, field)
    await expectAboveKeyboard(page, field)
  }
})

test('Správa, Nový člověk: the sheet moves up, each field stays visible', async ({ page }) => {
  await passwordLogin(page, 'admin')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await page.goto('/sprava')
  await page.getByRole('button', { name: cs.admin.add }).click()
  const sheet = page.getByRole('dialog')
  for (const name of [cs.admin.displayName, cs.admin.username, cs.admin.password]) {
    const field = sheet.getByRole('textbox', { name: new RegExp(`^${name}`) })
    await openKeyboard(page, field)
    await expectAboveKeyboard(page, field)
  }
})
