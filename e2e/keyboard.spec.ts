import { test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'
import { expectAboveKeyboard, openKeyboard, PHONE, useKeyboard } from './keyboard'

// Forms with the phone keyboard open (e2e/keyboard.ts): the field a person types into and the
// button that sends it stay on the part of the screen the keyboard leaves. A form screen adds
// its case here when it is built.

test.use({ viewport: PHONE, isMobile: true, hasTouch: true })

test.beforeEach(async ({ page }) => {
  await useKeyboard(page)
})

test('login: each field and Přihlásit stay above the keyboard', async ({ page }) => {
  await page.goto('/login')
  const submit = page.getByRole('button', { name: cs.login.submit, exact: true })
  for (const label of [cs.login.username, cs.login.password]) {
    const field = page.getByLabel(label, { exact: true })
    await openKeyboard(page, field)
    await expectAboveKeyboard(page, field)
    await expectAboveKeyboard(page, submit)
  }
})

test('Správa, Nový člověk: the sheet moves up, Heslo and Uložit stay visible', async ({ page }) => {
  await passwordLogin(page, 'admin')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await page.goto('/sprava')
  await page.getByRole('button', { name: cs.admin.add }).click()
  const sheet = page.getByRole('dialog')
  const field = sheet.getByRole('textbox', { name: cs.admin.password })
  await openKeyboard(page, field)
  await expectAboveKeyboard(page, field)
  await expectAboveKeyboard(page, sheet.getByRole('button', { name: cs.admin.save }))
})
