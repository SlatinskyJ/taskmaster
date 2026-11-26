import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// Profil → Aplikace (#302). Chromium in tests never fires a real `beforeinstallprompt`, so a
// fake one is dispatched at DOMContentLoaded, before hydration. Read-only: changes no data.

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

declare global {
  interface Window {
    __prompted?: number
    __firePrompt?: () => void
    __marker?: string
  }
}

/** On every page load: a fake install event at DOMContentLoaded; `__firePrompt` fires another. */
async function fakePrompt(page: Page, outcome: 'accepted' | 'dismissed') {
  await page.addInitScript((choice) => {
    window.__prompted = 0
    window.__firePrompt = () => {
      const event = new Event('beforeinstallprompt', { cancelable: true })
      Object.assign(event, {
        prompt: () => {
          window.__prompted = (window.__prompted ?? 0) + 1
          return Promise.resolve()
        },
        userChoice: Promise.resolve({ outcome: choice }),
      })
      window.dispatchEvent(event)
    }
    document.addEventListener('DOMContentLoaded', () => window.__firePrompt?.())
  }, outcome)
}

const section = (page: Page) => page.getByRole('heading', { name: cs.profile.installSection })
const installButton = (page: Page) => page.getByRole('button', { name: cs.profile.installButton })

/** Waits until React runs on Profil: a theme button reacts to a click. */
async function hydrated(page: Page) {
  const dark = page.getByRole('button', { name: cs.profile.themeDark })
  await dark.click()
  await expect(dark).toHaveAttribute('aria-pressed', 'true')
}

async function loginAsStarsi(page: Page) {
  await passwordLogin(page, 'starsi')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}

test('the event fired on Domů, before Profil was open: the button prompts; accepted hides it', async ({
  page,
}) => {
  await fakePrompt(page, 'accepted')
  await loginAsStarsi(page)
  await page.goto('/')
  // Same document from here on: Profil is reached by the in-app link, without a reload.
  await page.evaluate(() => {
    window.__marker = 'domu'
  })
  await page.getByRole('link', { name: cs.profile.open }).click()
  await expect(page).toHaveURL(/\/profil/)
  await expect(installButton(page)).toBeVisible()
  expect(await page.evaluate(() => window.__marker)).toBe('domu')

  await installButton(page).click()
  await expect(section(page)).toBeHidden()
  expect(await page.evaluate(() => window.__prompted)).toBe(1)
})

test('dismissed hides it until the browser offers again; appinstalled hides it', async ({
  page,
}) => {
  await fakePrompt(page, 'dismissed')
  await loginAsStarsi(page)
  await page.goto('/profil')
  await installButton(page).click()
  await expect(section(page)).toBeHidden()
  expect(await page.evaluate(() => window.__prompted)).toBe(1)

  await page.evaluate(() => window.__firePrompt?.())
  await expect(installButton(page)).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
  await expect(section(page)).toBeHidden()
})

test('no install event (desktop Firefox, Safari on a Mac): no section', async ({ page }) => {
  await loginAsStarsi(page)
  await page.goto('/profil')
  await hydrated(page)
  await expect(section(page)).toBeHidden()
})

test('iPhone: the button opens the three steps; Rozumím closes them', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: IPHONE_UA })
  const page = await context.newPage()
  await loginAsStarsi(page)
  await page.goto('/profil')
  await installButton(page).click()
  const sheet = page.getByRole('dialog', { name: cs.profile.installIosTitle })
  const steps = sheet.getByRole('listitem')
  await expect(steps).toHaveText([...cs.profile.installIosSteps])
  await sheet.getByRole('button', { name: cs.profile.installIosClose }).click()
  await expect(sheet).toBeHidden()
  await context.close()
})

test('iPhone, already on the home screen: no section', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: IPHONE_UA })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true })
  })
  const page = await context.newPage()
  await loginAsStarsi(page)
  await page.goto('/profil')
  await hydrated(page)
  await expect(section(page)).toBeHidden()
  await context.close()
})

test('running in standalone display mode: no section, even with an install event', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query: string) => {
      const list = original(query)
      if (query === '(display-mode: standalone)') {
        Object.defineProperty(list, 'matches', { value: true })
      }
      return list
    }
  })
  await fakePrompt(page, 'accepted')
  await loginAsStarsi(page)
  await page.goto('/profil')
  await hydrated(page)
  await expect(section(page)).toBeHidden()
})
