import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'
import { PHONE } from './keyboard'

// The week plan at Schůzka with live change notices on (#313), `planmeetinglive` seed: Táta
// settles, the plan shows without Obnovit and its hint, Starší reserves a cell on his phone, and
// the live change banner's refresh shows it in Táta's table.
// One test: each step builds on the one before.

test.use({ viewport: PHONE })

const TABLE = 'Prostřít stůl k večeři'
const m = cs.meeting

const planSection = (page: Page) => page.getByRole('region', { name: cs.plan.title })
const banner = (page: Page) =>
  page.locator('[data-sonner-toast]').filter({
    has: page.getByRole('button', { name: cs.live.banner.refresh, includeHidden: true }),
  })

test('with live notices on, Schůzka has no Obnovit and the banner refreshes the plan', async ({
  page,
  browser,
}) => {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/schuzka')
  await page.getByRole('button', { name: m.next }).click()
  await page.getByRole('button', { name: m.confirm }).click()
  await page.getByRole('button', { name: m.confirmYes, exact: true }).click()

  // Step 3: the plan shows, without Obnovit and its hint.
  const section = planSection(page)
  await expect(section).toBeVisible()
  await expect(section.getByRole('button', { name: m.refresh })).toHaveCount(0)
  await expect(section.getByText(m.planHint)).toHaveCount(0)

  const cell = section.locator(`button[aria-label^="${TABLE}, "][aria-label$=": volné"]`).first()
  const day = await cell.getAttribute('data-day')
  expect(day).not.toBeNull()
  const tataCell = section.locator(`button[data-day="${day ?? ''}"][aria-label^="${TABLE}, "]`)

  // Starší reserves that day on his own phone.
  const other = await browser.newContext({ viewport: PHONE, locale: 'cs-CZ' })
  const brother = await other.newPage()
  await passwordLogin(brother, 'starsi')
  await expect(brother).toHaveURL(/\/$/)
  await brother.goto('/tyden/plan')
  const his = brother.locator(`button[data-day="${day ?? ''}"][aria-label^="${TABLE}, "]`)
  await his.click()
  await expect(his).toHaveAttribute('aria-label', /: rezervováno tebou, uvolnit$/)
  await other.close()

  // Táta's banner offers the refresh; the table changes only when he taps it.
  await expect(banner(page)).toBeVisible({ timeout: 15_000 })
  await expect(tataCell).toHaveAttribute('aria-label', /: volné$/)
  await banner(page).getByRole('button', { name: cs.live.banner.refresh }).click()
  await expect(tataCell).toHaveAttribute('aria-label', /: rezervováno, Starší$/)
  await expect(section.getByRole('button', { name: m.refresh })).toHaveCount(0)
})
