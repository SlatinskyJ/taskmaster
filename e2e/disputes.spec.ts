import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { logout, passwordLogin } from './helpers'

// Rozporovat (#46) and the admin's Ponechat (#47) on the `disputes` seed: Starší's "Vysát auto"
// is already disputed, Mladší's past-week settlement was disputed and kept by the admin. Serial:
// the second test reads the dispute the first one opens; the admin then opens two cards (#222);
// the last keeps "Vysát auto".
test.describe.configure({ mode: 'serial' })

const row = (page: Page, title: string) =>
  page.locator('[data-slot="task-row"]').filter({ hasText: title })

test('Starší disputes a confirmed chore: Sporné, the chore stays Hotovo', async ({ page }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/tyden')
  await expect(row(page, 'Vysát auto')).toContainText(cs.disputes.waiting)

  const bath = row(page, 'Uklidit koupelnu')
  await bath
    .getByRole('button', {
      name: cs.disputes.actionFor(cs.disputes.what.completion, 'Uklidit koupelnu'),
    })
    .click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toContainText('Uklidit koupelnu · 40 bodů')
  const send = sheet.getByRole('button', { name: cs.disputes.send })
  await expect(send).toBeDisabled()
  await sheet.getByLabel(cs.disputes.reasonLabel).fill('Drhnul jsem i spáry, to je víc.')
  await send.click()
  await expect(page.getByText(cs.disputes.sent)).toBeVisible()
  await expect(bath).toContainText(cs.disputes.waiting)
  await expect(bath).toContainText(cs.state.confirmed)
})

test('Táta sees Sporné on both of Starší’s disputed chores', async ({ page }) => {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/tyden')
  await expect(row(page, 'Vysát auto')).toContainText(cs.disputes.waiting)
  await expect(row(page, 'Uklidit koupelnu')).toContainText(cs.disputes.waiting)
})

test('Mladší reads the admin’s answer on his settled week and in Rozporováno', async ({ page }) => {
  await passwordLogin(page, 'mladsi')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/tyden')
  await page.getByRole('tab', { name: cs.week.history }).click()
  const main = page.locator('main')
  const kept = cs.disputes.kept('Body sedí, zkontroloval jsem to s tátou.')
  await expect(main.locator('[data-record]')).toContainText(kept)
  // His settlement's entry (his chore dispute from the seed, #222, is listed too).
  const settled = main.locator('[data-dispute]').filter({ hasText: cs.disputes.what.settlement })
  await expect(settled).toContainText(kept)
  await expect(main.getByText(cs.disputes.list)).toBeVisible()
})

test('the admin opens a disputed task and a disputed chore from Sporné, read-only (#222)', async ({
  page,
}) => {
  const t = cs.admin.disputes
  await passwordLogin(page, 'admin')
  await expect(page).toHaveURL(/\/sprava$/)
  const card = (title: string) => page.locator('[data-admin-dispute]').filter({ hasText: title })
  const noActions = async () => {
    for (const name of [cs.work.reserve, cs.work.done, cs.disputes.action, cs.tasks.approve]) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
    }
  }

  // A task (Starší's completion dispute from the first test): its page, no action, ← back.
  await card('Uklidit koupelnu')
    .getByRole('link', { name: t.openFor(cs.disputes.what.completion, 'Uklidit koupelnu') })
    .click()
  await expect(page).toHaveURL(/\/ukol\/\d+$/)
  await expect(page.getByRole('heading', { name: 'Uklidit koupelnu' })).toBeVisible()
  await expect(page.getByText(cs.history.title, { exact: true })).toBeVisible()
  await noActions()
  await page.getByRole('link', { name: cs.profile.back }).click()
  await expect(page).toHaveURL(/\/sprava$/)

  // A chore (Mladší's score dispute in the seed): the chore's page with its price history.
  await card('Vyndat myčku')
    .getByRole('link', {
      name: t.openFor(cs.disputes.what.template_score, 'Vyndat myčku'),
    })
    .click()
  await expect(page).toHaveURL(/\/sablona\/\d+$/)
  await expect(page.getByRole('heading', { name: 'Vyndat myčku' })).toBeVisible()
  await expect(page.getByText(cs.templatePrice.history)).toBeVisible()
  await noActions()
  await page.getByRole('link', { name: cs.profile.back }).click()
  await expect(page).toHaveURL(/\/sprava$/)

  // Ponechat opens its dialog and stays on Správa; a settlement card has no link.
  await card('Vyndat myčku')
    .getByRole('button', { name: t.keepFor(cs.disputes.what.template_score, 'Vyndat myčku') })
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page).toHaveURL(/\/sprava$/)
  await page.keyboard.press('Escape')
})

test('the admin keeps Starší’s "Vysát auto" dispute; Starší reads the note', async ({ page }) => {
  const t = cs.admin.disputes
  const note = 'Vysával jen kabinu, body sedí.'
  await passwordLogin(page, 'admin')
  await expect(page).toHaveURL(/\/sprava$/)
  const car = page.locator('[data-admin-dispute]').filter({ hasText: 'Vysát auto' })
  await expect(car).toContainText('Vysával jsem i kufr, to je víc práce.')
  await car
    .getByRole('button', { name: t.keepFor(cs.disputes.what.completion, 'Vysát auto') })
    .click()
  const dialog = page.getByRole('dialog')
  const confirm = dialog.getByRole('button', { name: t.confirm })
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel(t.noteLabel).fill(note)
  await confirm.click()
  await expect(page.getByText(t.done)).toBeVisible()
  await expect(car).toHaveCount(0)

  await logout(page)
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/tyden')
  await expect(row(page, 'Vysát auto')).toContainText(cs.disputes.kept(note))
})
