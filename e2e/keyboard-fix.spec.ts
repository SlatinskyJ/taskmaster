import { test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'
import { expectAboveKeyboard, openKeyboard, PHONE_BROWSER, useKeyboard } from './keyboard'

// The fix sheet (#48) with the phone keyboard open (e2e/keyboard.ts), on the `corrections` seed:
// the field a person types into stays visible (Jakub, 2026-11-24). Read-only: nothing is sent.

const { keyboard, ...viewport } = PHONE_BROWSER

test.use({ viewport, isMobile: true, hasTouch: true })

test.beforeEach(async ({ page }) => {
  await useKeyboard(page, keyboard)
})

test.describe('Správa, the fix sheet (#48)', () => {
  const t = cs.admin.fix

  test.beforeEach(async ({ page }) => {
    await passwordLogin(page, 'admin')
    await page.waitForURL((url) => !url.pathname.startsWith('/login'))
    await page.goto('/sprava')
  })

  test('Upravit body: Body and Důvod stay visible', async ({ page }) => {
    await page.getByRole('button', { name: t.adjust }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('button', { name: 'Anička', exact: true }).click()
    for (const label of [t.points, t.reason]) {
      const field = sheet.getByLabel(label)
      await openKeyboard(page, field)
      await expectAboveKeyboard(page, field)
    }
  })

  test('Opravit from a dispute with a long reason: Body and Důvod stay visible', async ({
    page,
  }) => {
    await page
      .locator('[data-admin-dispute]')
      .filter({ hasText: 'Nákup byl obrovský' })
      .getByRole('button', { name: new RegExp(`^${cs.admin.disputes.fix}: `) })
      .click()
    const sheet = page.getByRole('dialog')
    for (const label of [t.points, t.reason]) {
      const field = sheet.getByLabel(label)
      await openKeyboard(page, field)
      await expectAboveKeyboard(page, field)
    }
  })

  test('Opravit on a disputed week, the tallest sheet: Důvod stays visible', async ({ page }) => {
    await page
      .locator('[data-admin-dispute]')
      .filter({ hasText: 'Kapesné jsem nakonec dostal' })
      .getByRole('button', { name: new RegExp(`^${cs.admin.disputes.fix}: `) })
      .click()
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('button', { name: cs.meeting.level.lower, exact: true }).click()
    const field = sheet.getByLabel(t.reason)
    await openKeyboard(page, field)
    await expectAboveKeyboard(page, field)
  })

  test('Opravit týden: Důvod stays visible under the week and level pills', async ({ page }) => {
    await page.getByRole('button', { name: t.correct }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByRole('button', { name: 'Anička', exact: true }).click()
    await sheet
      .getByRole('button', { name: new RegExp(cs.week.total) })
      .first()
      .click()
    await sheet.getByRole('button', { name: cs.meeting.level.lower, exact: true }).click()
    const field = sheet.getByLabel(t.reason)
    await openKeyboard(page, field)
    await expectAboveKeyboard(page, field)
  })
})
