import { test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'
import { expectAboveKeyboard, openKeyboard, PHONE_BROWSER, useKeyboard } from './keyboard'

// The reject reason (#206) with the phone keyboard open (e2e/keyboard.ts), on the `approve` seed:
// the field a person types into stays visible (Jakub, 2026-11-24). Read-only: nothing is sent.
// Task 6 is "Vytřít podlahu v kuchyni", done and waiting (src/server/demo/suites.test.ts).

const { keyboard, ...viewport } = PHONE_BROWSER

test.use({ viewport, isMobile: true, hasTouch: true })

test.beforeEach(async ({ page }) => {
  await useKeyboard(page, keyboard)
  await passwordLogin(page, 'tata')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
})

test('Úkoly, ✕ on a row: Proč? stays visible', async ({ page }) => {
  await page.goto('/ukoly')
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Vytřít podlahu v kuchyni' })
    .getByRole('button', { name: cs.work.reject })
    .click()
  const field = page.getByLabel(cs.work.rejectReason)
  await openKeyboard(page, field)
  await expectAboveKeyboard(page, field)
})

test('Task page, Zamítnout: Proč? stays visible', async ({ page }) => {
  await page.goto('/ukol/6')
  await page.getByRole('button', { name: cs.work.reject, exact: true }).click()
  const field = page.getByLabel(cs.work.rejectReason)
  await openKeyboard(page, field)
  await expectAboveKeyboard(page, field)
})
