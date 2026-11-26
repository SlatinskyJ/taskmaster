import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { PASSWORD } from './helpers'

// The multi-user viewer /dev/multi (#265): a row of frames, each the real app logged in as a
// demo user with its own session. Frames reload only when the person asks (Obnovit, Obnovit
// vše, a new user, an address). Its own server on the `week` seed: Týden is on for the boys.

// Tall enough for a whole phone frame under the toolbar: Playwright does not scroll the page to
// reach a frame's fixed bottom bar.
test.use({ viewport: { width: 1440, height: 1200 } })

const t = cs.devMulti
const hello = (name: string) => `${cs.home.greeting}, ${name}!`

const device = (page: Page, i: number) => page.locator('[data-device]').nth(i)
const frameOf = (page: Page, i: number) => device(page, i).frameLocator('iframe')
const reloadOf = (page: Page, i: number) =>
  device(page, i).getByRole('button', { name: t.reload, exact: true })
const addressOf = (page: Page, i: number) => device(page, i).getByLabel(t.address)

/** The viewer's frames all logged in, as on a fresh browser. */
async function openViewer(page: Page) {
  await page.goto('/dev/multi')
  await expect(page.locator('[data-device]')).toHaveCount(3)
  await expect(frameOf(page, 0).getByRole('heading', { name: hello('Táta') })).toBeVisible()
  await expect(frameOf(page, 1).getByRole('heading', { name: hello('Starší') })).toBeVisible()
  await expect(frameOf(page, 2).getByRole('heading', { name: hello('Mladší') })).toBeVisible()
}

async function goTo(page: Page, i: number, path: string) {
  await addressOf(page, i).fill(path)
  await addressOf(page, i).press('Enter')
}

/** Táta proposes a one-time task in his frame. */
async function proposeTask(page: Page, title: string) {
  await goTo(page, 0, '/ukoly/novy')
  const tata = frameOf(page, 0)
  await tata.getByLabel(cs.tasks.title).fill(title)
  await tata.getByRole('button', { name: cs.tasks.propose, exact: true }).click()
  await expect(tata.getByText(cs.tasks.created, { exact: true })).toBeVisible()
}

async function pickUser(page: Page, i: number, name: string) {
  await device(page, i).getByRole('combobox', { name: t.user }).click()
  await page.getByRole('option', { name, exact: true }).click()
}

async function logOutIn(page: Page, i: number) {
  const frame = frameOf(page, i)
  await frame.getByRole('link', { name: cs.profile.open }).click()
  await frame.getByRole('button', { name: cs.login.logout }).click()
  await expect(frame.getByLabel(cs.login.username)).toBeVisible()
  return frame
}

test('three phones by default, each logged in as its own user', async ({ page }) => {
  await openViewer(page)
  await expect(page.getByRole('heading', { name: t.title })).toBeVisible()
})

test('add a device as admin on a tablet, remembered after reload', async ({ page }) => {
  await openViewer(page)
  await page.getByRole('button', { name: t.add }).click()
  await page.getByRole('combobox', { name: t.user }).last().click()
  await page.getByRole('option', { name: t.users.admin, exact: true }).click()
  await page.getByRole('combobox', { name: t.size }).last().click()
  await page.getByRole('option', { name: t.sizes.tablet, exact: true }).click()
  await page.getByRole('button', { name: t.confirmAdd, exact: true }).click()

  await expect(page.locator('[data-device]')).toHaveCount(4)
  await expect(frameOf(page, 3).getByRole('heading', { name: cs.admin.title })).toBeVisible()

  await page.reload()
  await expect(page.locator('[data-device]')).toHaveCount(4)
  await expect(frameOf(page, 3).getByRole('heading', { name: cs.admin.title })).toBeVisible()
})

test('a stale frame stays stale until Obnovit', async ({ page }) => {
  await openViewer(page)
  const task = 'Vyndat myčku a utřít linku'
  await proposeTask(page, task)

  const starsi = frameOf(page, 1)
  await expect(starsi.getByText(task)).toHaveCount(0)
  await reloadOf(page, 1).click()
  await expect(starsi.getByText(task)).toBeVisible()
})

test('logout inside a frame survives Obnovit', async ({ page }) => {
  await openViewer(page)
  const mladsi = await logOutIn(page, 2)

  await reloadOf(page, 2).click()
  await expect(mladsi.getByLabel(cs.login.username)).toBeVisible()
  await expect(mladsi.getByRole('heading', { name: hello('Mladší') })).toHaveCount(0)
  await expect(frameOf(page, 0).getByRole('heading', { name: hello('Táta') })).toBeVisible()
  await expect(frameOf(page, 1).getByRole('heading', { name: hello('Starší') })).toBeVisible()
})

test('someone else logging in inside a frame survives Obnovit', async ({ page }) => {
  await openViewer(page)
  const frame = await logOutIn(page, 2)
  await frame.getByLabel(cs.login.username).fill('tata')
  await frame.getByLabel(cs.login.password).fill(PASSWORD)
  await frame.getByRole('button', { name: cs.login.submit, exact: true }).click()
  await expect(frame.getByRole('heading', { name: hello('Táta') })).toBeVisible()

  await reloadOf(page, 2).click()
  await expect(frame.getByRole('heading', { name: hello('Táta') })).toBeVisible()
})

/** Marks the frame's document so a test can tell a reload from a client navigation. */
async function markDocument(page: Page, i: number) {
  await device(page, i)
    .locator('iframe')
    .evaluate((el: HTMLIFrameElement) => {
      ;(el.contentWindow as unknown as { tmMark?: boolean }).tmMark = true
    })
}

const isMarked = (page: Page, i: number) =>
  device(page, i)
    .locator('iframe')
    .evaluate(
      (el: HTMLIFrameElement) =>
        (el.contentWindow as unknown as { tmMark?: boolean } | null)?.tmMark === true,
    )

test('Obnovit keeps the frame on its current page', async ({ page }) => {
  await openViewer(page)
  const starsi = frameOf(page, 1)
  await starsi.getByRole('link', { name: cs.nav.week }).click()
  await expect(starsi.getByRole('heading', { name: cs.week.myTitle })).toBeVisible()

  await reloadOf(page, 1).click()
  await expect(starsi.getByRole('heading', { name: cs.week.myTitle })).toBeVisible()
  await expect(addressOf(page, 1)).toHaveValue('/tyden')

  // Obnovit vše reloads every frame at its own page: the marks are gone, the users stay.
  await markDocument(page, 0)
  await markDocument(page, 1)
  await page.getByRole('button', { name: t.reloadAll }).click()
  await expect.poll(() => isMarked(page, 1)).toBe(false)
  await expect.poll(() => isMarked(page, 0)).toBe(false)
  await expect(starsi.getByRole('heading', { name: cs.week.myTitle })).toBeVisible()
  await expect(addressOf(page, 1)).toHaveValue('/tyden')
  await expect(frameOf(page, 0).getByRole('heading', { name: hello('Táta') })).toBeVisible()
})

test('Obnovit vše shows what another frame changed', async ({ page }) => {
  await openViewer(page)
  const task = 'Umýt kola od bláta'
  await proposeTask(page, task)
  await expect(frameOf(page, 1).getByText(task)).toHaveCount(0)

  await page.getByRole('button', { name: t.reloadAll }).click()
  await expect(frameOf(page, 1).getByText(task)).toBeVisible()
  await expect(frameOf(page, 2).getByText(task)).toBeVisible()
})

test('address field navigates the frame on Enter', async ({ page }) => {
  await openViewer(page)
  await goTo(page, 0, '/tyden')
  const tata = frameOf(page, 0)
  await expect(tata.getByRole('heading', { name: cs.nav.week, level: 1 })).toBeVisible()
  await markDocument(page, 0)

  await goTo(page, 0, 'https://evil.example/x')
  await expect(addressOf(page, 0)).toHaveValue('/tyden')
  await expect(tata.getByRole('heading', { name: cs.nav.week, level: 1 })).toBeVisible()
  expect(await isMarked(page, 0)).toBe(true)
})

test('a frame never reloads by itself', async ({ page }) => {
  await openViewer(page)
  const tata = frameOf(page, 0)
  // Into the form by a client navigation, so the address field learns it only by reading back.
  await tata.getByRole('link', { name: cs.nav.tasks }).click()
  await tata.getByRole('link', { name: cs.tasks.new }).click()
  await tata.getByLabel(cs.tasks.title).fill('Rozepsaný úkol')
  // Leaving the frame reads its address back; that must not reload it.
  await page.getByRole('heading', { name: t.title }).click()
  await expect(addressOf(page, 0)).toHaveValue('/ukoly/novy')
  await expect(tata.getByLabel(cs.tasks.title)).toHaveValue('Rozepsaný úkol')
})

test('a failed frame login shows retry', async ({ page }) => {
  let failed = false
  await page.route('**/_serverFn/**', async (route) => {
    const body = route.request().postData() ?? ''
    if (!failed && route.request().method() === 'POST' && body.includes('starsi')) {
      failed = true
      await route.fulfill({ status: 500, body: 'boom' })
      return
    }
    await route.continue()
  })
  await page.goto('/dev/multi')
  const starsi = device(page, 1)
  await expect(starsi.getByText(t.loginFailed)).toBeVisible()
  await expect(frameOf(page, 0).getByRole('heading', { name: hello('Táta') })).toBeVisible()
  await expect(frameOf(page, 2).getByRole('heading', { name: hello('Mladší') })).toBeVisible()

  await starsi.getByRole('button', { name: t.retry }).click()
  await expect(frameOf(page, 1).getByRole('heading', { name: hello('Starší') })).toBeVisible()
  expect(failed).toBe(true)
})

test('changing a frame user logs the new user in', async ({ page }) => {
  await openViewer(page)
  await pickUser(page, 2, t.users.admin)
  await expect(frameOf(page, 2).getByRole('heading', { name: cs.admin.title })).toBeVisible()
})
