import { test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'
import { expectAboveKeyboard, openKeyboard, PHONE_BROWSER, useKeyboard } from './keyboard'

// The dispute forms (#46, #47) with the phone keyboard open (e2e/keyboard.ts), on the `disputes`
// seed: the field a person types into stays visible (Jakub, 2026-11-24), also with the longest
// text the form takes (1000 letters). Read-only: nothing is sent.

const { keyboard, ...viewport } = PHONE_BROWSER

test.use({ viewport, isMobile: true, hasTouch: true })

test.beforeEach(async ({ page }) => {
  await useKeyboard(page, keyboard)
})

const LONG_TEXT = 'Drhnul jsem i spáry. '.repeat(48).slice(0, 1000)

async function login(page: Page, username: string) {
  await passwordLogin(page, username)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}

/** Focus, check; fill the longest text, tap back in, check again. */
async function typeLong(page: Page, field: ReturnType<Page['getByLabel']>) {
  await openKeyboard(page, field)
  await expectAboveKeyboard(page, field)
  await field.fill(LONG_TEXT)
  await field.blur()
  await openKeyboard(page, field)
  await expectAboveKeyboard(page, field)
}

test('Týden, Rozporovat: Proč nesouhlasíš? stays visible, also with 1000 letters', async ({
  page,
}) => {
  await login(page, 'starsi')
  await page.goto('/tyden')
  await page
    .locator('[data-slot="task-row"]')
    .filter({ hasText: 'Uklidit koupelnu' })
    .getByRole('button', {
      name: cs.disputes.actionFor(cs.disputes.what.completion, 'Uklidit koupelnu'),
    })
    .click()
  await typeLong(page, page.getByRole('dialog').getByLabel(cs.disputes.reasonLabel))
})

test('Správa, Ponechat: the note stays visible, also with 1000 letters', async ({ page }) => {
  const t = cs.admin.disputes
  await login(page, 'admin')
  await page.goto('/sprava')
  await page
    .locator('[data-admin-dispute]')
    .filter({ hasText: 'Vysát auto' })
    .getByRole('button', { name: t.keepFor(cs.disputes.what.completion, 'Vysát auto') })
    .click()
  await typeLong(page, page.getByRole('dialog').getByLabel(t.noteLabel))
})
