import { test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'
import { expectAboveKeyboard, openKeyboard, PHONE_BROWSER, useKeyboard } from './keyboard'

// The description fields (#207) with the phone keyboard open (e2e/keyboard.ts), on the
// `descriptions` seed: the field a person types into stays visible (Jakub, 2026-11-24).
// Read-only: nothing is sent. Task 1 is "Uklidit kolárnu" (src/server/demo/suites.test.ts).

const { keyboard, ...viewport } = PHONE_BROWSER

test.use({ viewport, isMobile: true, hasTouch: true })

test.beforeEach(async ({ page }) => {
  await useKeyboard(page, keyboard)
  await passwordLogin(page, 'tata')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
})

const LONG_TEXT = 'Zamést celou podlahu. '.repeat(46).slice(0, 1000)

test('Nový úkol: Popis stays visible, also with 1000 letters', async ({ page }) => {
  await page.goto('/ukoly/novy')
  const field = page.getByLabel(cs.description.newField)
  await openKeyboard(page, field)
  await expectAboveKeyboard(page, field)
  await field.fill(LONG_TEXT)
  // Tapping back into the long text: the whole field still fits above the keyboard.
  await field.blur()
  await openKeyboard(page, field)
  await expectAboveKeyboard(page, field)
})

test('Task page, Upravit popis: the text stays visible, also with 1000 letters', async ({
  page,
}) => {
  await page.goto('/ukol/1')
  await page.getByRole('button', { name: cs.description.edit, exact: true }).click()
  const field = page.getByRole('dialog').getByLabel(cs.description.field)
  await openKeyboard(page, field)
  await expectAboveKeyboard(page, field)
  await field.fill(LONG_TEXT)
  // Tapping back into the long text: the whole field still fits above the keyboard.
  await field.blur()
  await openKeyboard(page, field)
  await expectAboveKeyboard(page, field)
})
