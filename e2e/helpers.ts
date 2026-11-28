import { expect, type Locator, type Page } from '@playwright/test'
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

/**
 * Clicks a control the screen shows disabled, as a visitor re-enabling it in DevTools would, so a
 * test reaches the server's own refusal. Removing the `disabled` attribute is not enough: React 19
 * reads its own `disabled` prop and drops the click. So this calls the element's React `onClick`
 * (from its `__reactProps$…` key) with a minimal event.
 */
export async function forceClick(target: Locator) {
  await target.evaluate((el) => {
    const props = el as unknown as Record<string, { onClick?: (e: unknown) => void } | undefined>
    const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'))
    const onClick = key ? props[key]?.onClick : undefined
    if (!onClick) throw new Error('forceClick: no React onClick on this element')
    onClick({
      type: 'click',
      target: el,
      currentTarget: el,
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
    })
  })
}
