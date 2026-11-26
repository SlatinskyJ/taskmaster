import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// Suggestions (#247) on the `suggestions` seed: Starší's "Tmavý režim…" and Mladší's "Zvuk…"
// are new, Táta's is done, one of Starší's dismissed (src/server/demo/pieces.ts). Serial: each
// test writes for good and the admin's test counts what the first one sent. The e2e servers
// have no GitHub token, so Poslat na GitHub stops at its preview.
test.describe.configure({ mode: 'serial' })

const t = cs.suggestions
const DARK = 'Tmavý režim i na obrazovce Týden'
const SOUND = 'Zvuk, když dokončím úkol'
const BREAK = 'Delší přestávka mezi úkoly'
const SERVER_FN = '**/_serverFn/**'

const row = (page: Page, title: string) =>
  page.locator('[data-suggestion]').filter({ hasText: title })

async function profileAs(page: Page, username: string) {
  await passwordLogin(page, username)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await page.goto('/profil')
}

const openSheet = async (page: Page) => {
  await page.getByRole('button', { name: t.row }).click()
  return page.getByRole('dialog', { name: t.sheetTitle })
}

test('Mladší suggests from Profil; Moje návrhy lists it first, as Nový', async ({ page }) => {
  await profileAs(page, 'mladsi')
  const sheet = await openSheet(page)
  const title = sheet.getByLabel(t.titleLabel, { exact: true })
  await title.click()
  await expect(title).toBeFocused()
  await title.fill(BREAK)
  // Return moves to Popis, it doesn't send.
  await title.press('Enter')
  const description = sheet.getByLabel(t.descriptionLabel, { exact: true })
  await expect(description).toBeFocused()
  await description.fill('Po třech úkolech chvilku pauzu.\nAť si odpočinu.')

  // Hold the request so the busy state can be seen.
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(SERVER_FN, async (route) => {
    if (route.request().method() === 'POST') await held
    await route.continue()
  })
  const send = sheet.getByRole('button', { name: t.send })
  await send.click()
  const busy = sheet.getByRole('button', { name: t.sending })
  await expect(busy).toBeDisabled()
  await expect(busy).toHaveAttribute('aria-busy', 'true')
  release()
  await expect(page.getByText(t.sent)).toBeVisible()
  await expect(sheet).toBeHidden()
  await page.unroute(SERVER_FN)

  const mine = page.locator('[data-suggestion]')
  await expect(mine.first()).toContainText(BREAK)
  await expect(mine.first()).toContainText(t.status.new)
  await expect(row(page, BREAK)).toContainText('Ať si odpočinu.')
  await expect(mine.nth(1)).toContainText(SOUND)
  // Only his own.
  await expect(mine).toHaveCount(2)
  await expect(page.getByText(DARK)).toHaveCount(0)
})

test('the admin closes two on Správa and opens the send preview of the third', async ({ page }) => {
  await passwordLogin(page, 'admin')
  await expect(page).toHaveURL(/\/sprava$/)
  const label = page.locator('#admin-suggestions-label')
  await expect(label).toHaveText('Návrhy · 3 nové')
  await expect(row(page, SOUND)).toContainText('Mladší')

  await row(page, SOUND).getByRole('button', { name: t.done }).click()
  const confirm = page.getByRole('dialog', { name: t.confirmDone })
  await expect(confirm).toContainText(t.confirmFinal)
  await confirm.getByRole('button', { name: t.done }).click()
  await expect(confirm).toBeHidden()
  await expect(row(page, SOUND)).toContainText(t.status.done)
  await expect(row(page, SOUND).getByRole('button')).toHaveCount(0)
  await expect(label).toHaveText('Návrhy · 2 nové')

  await row(page, BREAK).getByRole('button', { name: t.dismiss }).click()
  const dismiss = page.getByRole('dialog', { name: t.confirmDismiss })
  await dismiss.getByRole('button', { name: t.dismiss }).click()
  await expect(dismiss).toBeHidden()
  await expect(row(page, BREAK)).toContainText(t.status.dismissed)
  await expect(label).toHaveText('Návrhy · 1 nový')

  await row(page, DARK).getByRole('button', { name: t.sendRow }).click()
  const preview = page.getByRole('dialog', { name: t.previewTitle })
  await expect(preview.getByLabel(t.issueTitleLabel, { exact: true })).toHaveValue(DARK)
  await expect(preview.getByLabel(t.issueBodyLabel, { exact: true })).toHaveValue(
    /Večer mě to světlo oslňuje\./,
  )
  await expect(preview).not.toContainText('Starší')
  await expect(preview).toContainText(t.publicNote)
  await expect(preview).toContainText(t.noToken)
  await expect(preview.getByRole('button', { name: t.sendIssue })).toBeDisabled()
})

test('a title of only spaces is refused before anything is sent', async ({ page }) => {
  await profileAs(page, 'starsi')
  const sheet = await openSheet(page)
  const posts: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/_serverFn/')) posts.push(r.url())
  })
  await sheet.getByLabel(t.titleLabel, { exact: true }).fill('   ')
  await sheet.getByRole('button', { name: t.send }).click()
  await expect(sheet.getByRole('alert')).toHaveText(t.errors.title_empty)
  expect(posts).toEqual([])
})

test('a double tap on Odeslat sends once', async ({ page }) => {
  const title = 'Odměna za celý týden bez připomínání'
  await profileAs(page, 'tata')
  const sheet = await openSheet(page)
  await sheet.getByLabel(t.titleLabel, { exact: true }).fill(title)
  const posts: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/_serverFn/')) posts.push(r.url())
  })
  await sheet.getByRole('button', { name: t.send }).dblclick()
  await expect(page.getByText(t.sent)).toBeVisible()
  await expect(row(page, title)).toHaveCount(1)
  expect(posts).toHaveLength(1)
})
