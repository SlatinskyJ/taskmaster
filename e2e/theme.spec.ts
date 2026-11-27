import { expect, test, type Page } from '@playwright/test'
import { THEME_COLORS } from '../src/lib/themeColor'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// Profil → Vzhled (#124): the browser's theme-color follows a theme forced in the app.
// The phone is light (Playwright's default colour scheme). The browser uses the first
// theme-color that matches, so a forced theme puts its own one first. Read-only: the choice
// lives in this browser's storage.

const { light: LIGHT, dark: DARK } = THEME_COLORS

/** The content of every theme-color meta, in page order. */
const metaColors = (page: Page) =>
  page
    .locator('meta[name="theme-color"]')
    .evaluateAll((metas) => metas.map((meta) => meta.getAttribute('content')))

const themeButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

test('theme-color follows Světlý, Tmavý and Podle telefonu, also after a reload (#124)', async ({
  page,
}) => {
  await passwordLogin(page, 'tata')
  await expect(page).not.toHaveURL(/\/login/)
  await page.goto('/profil')
  // The page's two metas only: nothing forced yet.
  expect(await metaColors(page)).toEqual([LIGHT, DARK])

  await themeButton(page, cs.profile.themeDark).click()
  await expect.poll(() => metaColors(page)).toEqual([DARK, LIGHT, DARK])

  // After a reload only the boot script, before React, can have added the forced one. Wait
  // until React has hydrated (the server renders Podle telefonu as pressed), then check that
  // it kept the page's metas as they were and added none.
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(themeButton(page, cs.profile.themeDark)).toHaveAttribute('aria-pressed', 'true')
  expect(await metaColors(page)).toEqual([DARK, LIGHT, DARK])

  await themeButton(page, cs.profile.themeLight).click()
  await expect.poll(() => metaColors(page)).toEqual([LIGHT, LIGHT, DARK])
  await themeButton(page, cs.profile.themeAuto).click()
  await expect.poll(() => metaColors(page)).toEqual([LIGHT, DARK])
})
