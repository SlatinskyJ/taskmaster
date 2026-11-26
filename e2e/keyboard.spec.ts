import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'
import {
  expectAboveKeyboard,
  KEYBOARD_HEIGHT,
  openKeyboard,
  panKeyboard,
  PHONE,
  PHONE_BROWSER,
  useKeyboard,
} from './keyboard'

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

test('Správa, Nový člověk: Uložit comes after the last field in the same scroll (#159)', async ({
  page,
}) => {
  await passwordLogin(page, 'admin')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await page.goto('/sprava')
  await page.getByRole('button', { name: cs.admin.add }).click()
  const sheet = page.getByRole('dialog')
  const body = sheet.locator('[data-slot="person-form-body"]')
  const name = sheet.getByRole('textbox', { name: new RegExp(`^${cs.admin.displayName}`) })
  const password = sheet.getByRole('textbox', { name: new RegExp(`^${cs.admin.password}`) })
  const save = body.getByRole('button', { name: cs.admin.save, exact: true })
  // Uložit lives in the fields' own scroll body, below the last field: nothing pinned under
  // the first fields pretends the form ends there.
  await expect(save).toBeAttached()
  await openKeyboard(page, name)
  await expectAboveKeyboard(page, name)
  const [p, s] = await Promise.all([password.boundingBox(), save.boundingBox()])
  expect(p && s && s.y > p.y).toBe(true)
  // The admin scrolls the sheet to the end: Uložit comes into view above the keyboard.
  await openKeyboard(page, password)
  await expectAboveKeyboard(page, password)
  await save.scrollIntoViewIfNeeded()
  await expectAboveKeyboard(page, save)
})

test.describe('the installed app on an iPhone', () => {
  test.use({ viewport: PHONE })

  test('Správa, Nový člověk: a refusal shows above the keyboard (#159)', async ({ page }) => {
    await useKeyboard(page, KEYBOARD_HEIGHT)
    await passwordLogin(page, 'admin')
    await page.waitForURL((url) => !url.pathname.startsWith('/login'))
    await page.goto('/sprava')
    await page.getByRole('button', { name: cs.admin.add }).click()
    const sheet = page.getByRole('dialog')
    const field = (name: string) => sheet.getByRole('textbox', { name: new RegExp(`^${name}`) })
    await field(cs.admin.displayName).fill('Táta dvakrát')
    // `tata` is taken on this seed, so the server refuses.
    await field(cs.admin.username).fill('tata')
    const password = field(cs.admin.password)
    await openKeyboard(page, password)
    await password.fill('heslo1234')
    await password.press('Enter')
    const alert = sheet.getByRole('alert')
    await expect(alert).toBeVisible()
    await expectAboveKeyboard(page, alert)
  })
})

async function openResetDialog(page: Page) {
  await passwordLogin(page, 'admin')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await page.goto('/sprava')
  await page.getByRole('button', { name: cs.admin.editPerson('Táta') }).click()
  await page.getByRole('button', { name: cs.admin.reset }).click()
  const dialog = page.getByRole('dialog', { name: cs.admin.resetTitle })
  // The dialog focuses its field on open (#215): no tap, the keyboard is already up.
  await expect(page.locator('#__keyboard')).toBeAttached()
  return { dialog, field: dialog.getByRole('textbox') }
}

test('Správa, Nové heslo: the dialog’s field is visible when it opens', async ({ page }) => {
  const { field } = await openResetDialog(page)
  await expectAboveKeyboard(page, field)
})

test('Správa, Nové heslo: the dialog follows the visible part when iOS slides it down', async ({
  page,
}) => {
  const { dialog, field } = await openResetDialog(page)
  await panKeyboard(page, 250)
  await expectAboveKeyboard(page, dialog)
  await expectAboveKeyboard(page, field)
})

async function openCancelDialog(page: Page) {
  await passwordLogin(page, 'tata')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  // The `tasks` seed's only task, so the first id; the heading proves it.
  await page.goto('/ukol/1')
  await expect(page.getByRole('heading', { name: 'Shrabat listí na zahradě' })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(cs.cancelTask.hint) }).click()
  const dialog = page.getByRole('dialog', { name: cs.cancelTask.title })
  return { dialog, field: dialog.getByLabel(cs.cancelTask.reason) }
}

test('Úkol, Zrušit úkol?: the reason field is visible when typing', async ({ page }) => {
  const { field } = await openCancelDialog(page)
  await openKeyboard(page, field)
  await expectAboveKeyboard(page, field)
})

test('Úkol, Zrušit úkol? with a taller keyboard: the dialog shrinks and scrolls inside', async ({
  page,
}) => {
  await useKeyboard(page, 450) // after beforeEach's: this one wins
  const { dialog, field } = await openCancelDialog(page)
  await openKeyboard(page, field)
  await expectAboveKeyboard(page, dialog)
  await expectAboveKeyboard(page, field)
})
