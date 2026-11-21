import { expect, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'

// Shared steps for the browser tests. Demo family from TASKMASTER_ENV=preview.

export const PASSWORD = 'demo1234'

export async function passwordLogin(page: Page, username: string, path = '/login') {
  await page.goto(path)
  await page.getByLabel(cs.login.username).fill(username)
  await page.getByLabel(cs.login.password).fill(PASSWORD)
  await page.getByRole('button', { name: cs.login.submit, exact: true }).click()
}

export async function logout(page: Page) {
  await page.goto('/profil')
  await page.getByRole('button', { name: cs.login.logout }).click()
  await expect(page).toHaveURL(/\/login/)
}

export const bottomBar = (page: Page) => page.getByRole('navigation', { name: cs.nav.label })
