import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'
import { PHONE } from './keyboard'

// The plan table on Týden (#258) on the `plantable` seed: the week started yesterday at 00:00,
// four chores with a copy for every scheduled day. Today Mladší holds "Vyluxovat celý obývák a
// chodbu", Starší's "Zalít kytky na balkoně" waits for approval and "Prostřít stůl k večeři" is
// free. Cells are found by today's column (`data-today`) and the chore's name in their label,
// never by a weekday. The tests run in order: each leaves the table as the next one expects.

test.describe.configure({ mode: 'serial' })
test.use({ viewport: PHONE })

const TABLE = 'Prostřít stůl k večeři'
const VACUUM = 'Vyluxovat celý obývák a chodbu'

/** Today's cell of a chore. */
const today = (page: Page, title: string) =>
  page.locator(`button[data-today][aria-label^="${title}, "]`)

async function openPlan(page: Page, username: string) {
  await passwordLogin(page, username)
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/tyden/plan')
  await expect(page.getByRole('heading', { name: cs.plan.title })).toBeVisible()
}

/** Taps a brother's own cell and frees it in the Uvolnit sheet. */
async function releaseOwn(page: Page, title: string) {
  const cell = today(page, title)
  await expect(cell).toHaveAttribute('aria-label', /: rezervováno tebou, uvolnit$/)
  await cell.click()
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('button', { name: cs.plan.close, exact: true })).toBeVisible()
  await sheet.getByRole('button', { name: cs.work.release, exact: true }).click()
  await expect(page.getByText(cs.work.toast.released)).toBeVisible()
  await expect(sheet).toBeHidden()
  await expect(cell).toHaveAttribute('aria-label', /: volné, rezervovat$/)
}

test('Starší, portrait: Týden card → table; a tap reserves a free cell, a second tap offers Uvolnit, Uvolnit frees it', async ({
  page,
}) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/tyden')
  const card = page.getByRole('link', { name: new RegExp(cs.plan.title) })
  await expect(card).toContainText('Volných:')
  await card.click()
  await expect(page).toHaveURL(/\/tyden\/plan$/)
  await expect(page.getByText(cs.plan.turnHint)).toBeVisible()

  const cell = today(page, TABLE)
  await expect(cell).toHaveAttribute('aria-label', /: volné, rezervovat$/)
  await cell.click()
  await expect(page.getByText(/^Rezervováno: \S+$/)).toBeVisible()
  await expect(cell).toHaveAttribute('aria-label', /: rezervováno tebou, uvolnit$/)
  await releaseOwn(page, TABLE)
})

test("Starší: Mladší's reserved cell opens its task page", async ({ page }) => {
  await openPlan(page, 'starsi')
  const cell = today(page, VACUUM)
  await expect(cell).toHaveAttribute('aria-label', /: rezervováno, Mladší$/)
  await cell.click()
  await expect(page).toHaveURL(/\/ukol\/\d+$/)
})

test('a stale free cell says someone was faster and shows his avatar', async ({
  page,
  browser,
}) => {
  await openPlan(page, 'starsi')
  await expect(today(page, TABLE)).toHaveAttribute('aria-label', /: volné, rezervovat$/)

  const other = await browser.newContext({ viewport: PHONE, locale: 'cs-CZ' })
  const brother = await other.newPage()
  await openPlan(brother, 'mladsi')
  await today(brother, TABLE).click()
  await expect(today(brother, TABLE)).toHaveAttribute('aria-label', /: rezervováno tebou, uvolnit$/)

  // Starší's table has not reloaded: the cell still says free.
  await today(page, TABLE).click()
  await expect(page.getByText(cs.tasks.errors.reservedByOther)).toBeVisible()
  await expect(today(page, TABLE)).toHaveAttribute('aria-label', /: rezervováno, Mladší$/)

  await releaseOwn(brother, TABLE)
  await other.close()
})

test('landscape: every day fits without sideways scroll, no turn hint', async ({ page }) => {
  await page.setViewportSize({ width: PHONE.height, height: PHONE.width })
  await openPlan(page, 'starsi')
  await expect(page.getByText(cs.plan.turnHint)).toBeHidden()
  await expect(page.getByText(cs.plan.tapHint)).toBeVisible()
  const days = page.locator('[data-slot="plan-days"]')
  const fits = await days.evaluate((el) => el.scrollWidth <= el.clientWidth)
  expect(fits).toBe(true)
  const headers = page.locator('[data-header]')
  const n = await headers.count()
  expect(n).toBeGreaterThanOrEqual(2)
  for (let i = 0; i < n; i++) await expect(headers.nth(i)).toBeInViewport()
  // Each day column is still a 44 px tap target.
  const box = await today(page, TABLE).boundingBox()
  expect(box?.width).toBeGreaterThanOrEqual(44)
  expect(box?.height).toBeGreaterThanOrEqual(44)
})

test('busy: while a reserve is in flight every cell is disabled and the tapped one is aria-busy', async ({
  page,
}) => {
  await openPlan(page, 'starsi')
  const gate: { open?: () => void } = {}
  const held = new Promise<void>((resolve) => {
    gate.open = resolve
  })
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().method() === 'POST') await held
    await route.continue()
  })
  const cell = today(page, TABLE)
  await cell.click()
  await expect(cell).toHaveAttribute('aria-busy', 'true')
  const buttons = page.locator('button[data-day]')
  const n = await buttons.count()
  for (let i = 0; i < n; i++) await expect(buttons.nth(i)).toBeDisabled()
  gate.open?.()
  await expect(cell).toHaveAttribute('aria-label', /: rezervováno tebou, uvolnit$/)
  await expect(cell).not.toHaveAttribute('aria-busy', 'true')
  await page.unroute('**/_serverFn/**')
  await releaseOwn(page, TABLE)
})

test('Táta: a free cell opens its page; + Teď makes a second copy, the count opens the list', async ({
  page,
}) => {
  await openPlan(page, 'tata')
  await expect(page.getByText(cs.plan.tapHint)).toHaveCount(0)
  const cell = today(page, TABLE)
  await expect(cell).toHaveAttribute('aria-label', /: volné$/)
  await cell.click()
  await expect(page).toHaveURL(/\/ukol\/\d+$/)

  await page.goto('/ukoly')
  await page
    .getByRole('region', { name: cs.templates.section })
    .getByRole('listitem')
    .filter({ hasText: TABLE })
    .getByRole('button', { name: cs.instances.now })
    .click()
  await expect(page.getByText(cs.instances.toast.created)).toBeVisible()

  await page.goto('/tyden/plan')
  await expect(cell).toHaveAttribute(
    'aria-label',
    `${TABLE}, ${await weekday(page)}: 2 kopie, otevřít seznam`,
  )
  await cell.click()
  const sheet = page.getByRole('dialog')
  const rows = sheet.getByRole('listitem')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(1)).toContainText(/Navíc \d{1,2}:\d{2} · Volné/)
  await expect(rows.first().getByRole('link')).toHaveAttribute('href', /\/ukol\/\d+$/)
  await expect(sheet.getByRole('button', { name: cs.work.reserve })).toHaveCount(0)
})

test('Starší: the list reserves and releases the extra copy', async ({ page }) => {
  await openPlan(page, 'starsi')
  await today(page, TABLE).click()
  const sheet = page.getByRole('dialog')
  const extra = sheet.getByRole('listitem').filter({ hasText: /Navíc \d/ })
  await extra.getByRole('button', { name: cs.work.reserve, exact: true }).click()
  await expect(page.getByText(/^Rezervováno: \S+$/)).toBeVisible()
  await expect(extra).toContainText(`· ${cs.plan.byYou}`)
  await extra.getByRole('button', { name: cs.work.release, exact: true }).click()
  await expect(page.getByText(cs.work.toast.released)).toBeVisible()
  await expect(extra.getByRole('button', { name: cs.work.reserve, exact: true })).toBeVisible()
})

for (const width of [393, 360])
  test(`${String(width)} px portrait: the long name shows whole in the pinned column`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 360 ? 800 : PHONE.height })
    await openPlan(page, 'starsi')
    const name = page.locator('[data-slot="plan-names"] > div').filter({ hasText: VACUUM })
    await expect(name).toBeVisible()
    const fits = await name.evaluate((el) => el.scrollWidth <= el.clientWidth)
    expect(fits).toBe(true)
    // Not clamped: the title's whole text fits its box.
    const title = name.locator('span').first()
    const whole = await title.evaluate((el) => el.scrollHeight <= el.clientHeight)
    expect(whole).toBe(true)
    const nameBox = await name.boundingBox()
    const cellBox = await today(page, VACUUM).boundingBox()
    expect(nameBox?.height).toBeLessThanOrEqual(68)
    expect(cellBox?.height).toBeGreaterThanOrEqual(44)
    // The name and its cells share one row height.
    expect(Math.abs((nameBox?.y ?? 0) - (cellBox?.y ?? 0))).toBeLessThanOrEqual(4)
  })

/** Today's weekday as the table's header shows it ("Čt"). */
async function weekday(page: Page): Promise<string> {
  const header = page.locator('[data-header][aria-current="date"] span span').first()
  return (await header.textContent()) ?? ''
}
