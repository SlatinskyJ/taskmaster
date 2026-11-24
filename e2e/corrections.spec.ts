import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { logout, passwordLogin } from './helpers'

// Opravy bodů (#48) on the `corrections` seed: the admin gave Starší +5 (he disputed it) and
// corrected Mladší's past week to Bez kapesného. Serial: each test writes a fix for good and
// the last one disputes the −2 the second one gives.
test.describe.configure({ mode: 'serial' })

const t = cs.admin.fix
/** The seed's +5 for Starší (src/server/demo/pieces.ts, ADJUSTMENT_REASON). */
const ADJUSTMENT_REASON = 'Pomohl s velkým nákupem navíc a odnesl tašky až nahoru.'
const row = (page: Page, text: string) =>
  page.locator('[data-slot="task-row"]').filter({ hasText: text })

async function asAdmin(page: Page) {
  await passwordLogin(page, 'admin')
  await expect(page).toHaveURL(/\/sprava$/)
}

async function switchTo(page: Page, username: string) {
  await logout(page)
  await passwordLogin(page, username)
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/tyden')
}

test('Opravit on Starší’s disputed +5: Přidat 5, the row goes, he reads the answer', async ({
  page,
}) => {
  const reason = 'Máš pravdu, nákup byl velký. Přidávám 5.'
  await asAdmin(page)
  const disputed = page.locator('[data-admin-dispute]').filter({ hasText: ADJUSTMENT_REASON })
  await disputed
    .getByRole('button', {
      name: cs.admin.disputes.fixFor(cs.disputes.what.adjustment, ADJUSTMENT_REASON),
    })
    .click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('button', { name: 'Starší', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await sheet.getByLabel(t.points).fill('5')
  await sheet.getByLabel(t.reason).fill(reason)
  await sheet.getByRole('button', { name: t.sendAdd(5, 'Starší') }).click()
  await expect(page.getByText(t.done)).toBeVisible()
  await expect(disputed).toHaveCount(0)

  await switchTo(page, 'starsi')
  await page.getByRole('tab', { name: cs.week.history }).click()
  await expect(
    page.locator('main [data-dispute]').filter({ hasText: ADJUSTMENT_REASON }),
  ).toContainText(cs.disputes.fixed(reason))
})

test('Upravit body: Ubrat 2 for Mladší; his Týden shows the −2 row', async ({ page }) => {
  await asAdmin(page)
  await page.getByRole('button', { name: t.adjust }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: 'Mladší', exact: true }).click()
  await sheet.getByRole('button', { name: t.remove }).click()
  await sheet.getByLabel(t.points).fill('2')
  await sheet.getByLabel(t.reason).fill('Rozbil hrnek.')
  await sheet.getByRole('button', { name: t.sendRemove(2, 'Mladší') }).click()
  await expect(page.getByText(t.done)).toBeVisible()

  await switchTo(page, 'mladsi')
  const minus = row(page, 'Rozbil hrnek.')
  await expect(minus).toContainText(cs.week.adjustment)
  await expect(minus).toContainText('−2 b.')
})

test('Opravit týden: Starší’s past week to Spodní hranice; his Historie shows it', async ({
  page,
}) => {
  const reason = 'Úkol z pondělí se počítal dvakrát.'
  await asAdmin(page)
  await page.getByRole('button', { name: t.correct }).click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: 'Starší', exact: true }).click()
  await sheet
    .getByRole('button', { name: new RegExp(cs.week.total) })
    .first()
    .click()
  const lower = cs.meeting.level.lower
  await sheet.getByRole('button', { name: lower, exact: true }).click()
  await sheet.getByLabel(t.reason).fill(reason)
  await sheet.getByRole('button', { name: t.sendCorrect(lower, 'Starší') }).click()
  await expect(page.getByText(t.done)).toBeVisible()

  await switchTo(page, 'starsi')
  await page.getByRole('tab', { name: cs.week.history }).click()
  const record = page.locator('main [data-record]')
  await expect(record).toContainText(lower)
  await expect(record).toContainText(
    `Opraveno na úroveň ${lower} (původně ${cs.meeting.level.upper})`,
  )
  await expect(record).toContainText(reason)
})

test('Mladší disputes his −2; Sporné lists it for the admin', async ({ page }) => {
  await passwordLogin(page, 'mladsi')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/tyden')
  const minus = row(page, 'Rozbil hrnek.')
  await minus
    .getByRole('button', {
      name: cs.disputes.actionFor(cs.disputes.what.adjustment, cs.week.adjustment),
    })
    .click()
  const sheet = page.getByRole('dialog')
  await sheet.getByLabel(cs.disputes.reasonLabel).fill('Hrnek byl už prasklý.')
  await sheet.getByRole('button', { name: cs.disputes.send }).click()
  await expect(page.getByText(cs.disputes.sent)).toBeVisible()
  await expect(minus).toContainText(cs.disputes.waiting)

  await logout(page)
  await asAdmin(page)
  await expect(
    page.locator('[data-admin-dispute]').filter({ hasText: 'Hrnek byl už prasklý.' }),
  ).toContainText('Rozbil hrnek.')
})
