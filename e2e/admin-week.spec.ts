import { expect, test } from '@playwright/test'
import type { Browser, Page, Request } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// A kid's week for the admin (#263) on the `corrections` seed: Béďa disputes his past
// week (corrected to Bez kapesného) and Anička the +5 the admin gave her this week. Read-only.

const t = cs.admin.disputes
/** The seed's texts (src/server/demo/pieces.ts). */
const ADJUSTMENT_REASON = 'Pomohla s velkým nákupem navíc a odnesla tašky až nahoru.'
const CORRECTION_REASON = 'Kapesné za minulý týden nedostal, body se mu vrací.'
const WEEK_URL = /\/sprava\/tyden\/\d+\/\d+$/

async function asAdmin(page: Page) {
  await passwordLogin(page, 'admin')
  await expect(page).toHaveURL(/\/sprava$/)
}

/** The Sporné card of `what` for `name`'s item, and its stretched link. */
function cardLink(page: Page, what: string, name: string) {
  return page
    .locator('[data-admin-dispute]')
    .filter({ hasText: what })
    .filter({ hasText: name })
    .getByRole('link', { name: new RegExp(`^${t.openFor(what, '')}`) })
}

/** The admin week's server-function call, sent while the admin opens Béďa's week. */
async function openSettlementWeek(page: Page): Promise<Request> {
  const sent = page.waitForRequest(
    (r) => r.url().includes('/_serverFn/') && r.method() === 'GET' && r.url().includes('takerId'),
  )
  await cardLink(page, cs.disputes.what.settlement, 'Béďa').click()
  await expect(page).toHaveURL(WEEK_URL)
  return sent
}

test('the admin opens a disputed settlement: its level, correction and tasks', async ({ page }) => {
  await asAdmin(page)
  await openSettlementWeek(page)
  await expect(page.getByRole('heading', { name: cs.admin.week.title('Béďa') })).toBeVisible()
  const main = page.locator('main')
  await expect(main.getByText(cs.meeting.level.none, { exact: true })).toBeVisible()
  await expect(main.getByText(CORRECTION_REASON)).toBeVisible()
  await expect(main.getByText(cs.admin.week.notSettled)).toHaveCount(0)
  await expect(
    main.locator('[data-slot="task-row"]').filter({ hasText: 'Nakrmit kočku' }),
  ).toBeVisible()
  await expect(main.getByText('Vytřít podlahu')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Rozporovat/ })).toHaveCount(0)
  await page.getByRole('link', { name: cs.profile.back }).click()
  await expect(page).toHaveURL(/\/sprava$/)
})

test('the admin opens a disputed adjustment: the week it counts in', async ({ page }) => {
  await asAdmin(page)
  await cardLink(page, cs.disputes.what.adjustment, ADJUSTMENT_REASON).click()
  await expect(page).toHaveURL(WEEK_URL)
  await expect(page.getByRole('heading', { name: cs.admin.week.title('Anička') })).toBeVisible()
  const row = page.locator('main [data-slot="task-row"]').filter({ hasText: ADJUSTMENT_REASON })
  await expect(row).toContainText(cs.week.adjustment)
  await expect(row).toContainText('+5')
  await expect(page.getByText(cs.admin.week.notSettled)).toBeVisible()
})

test('a brother cannot open it', async ({ page }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/sprava/tyden/1/2')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: /Týden: / })).toHaveCount(0)
})

/** `username` replays the admin's request with his own session. */
async function replayAs(browser: Browser, sent: Request, username: string) {
  const origin = new URL(sent.url()).origin
  const other = await browser.newPage({ baseURL: origin })
  await passwordLogin(other, username)
  await expect(other).toHaveURL(/\/$/)
  const headers = Object.fromEntries(
    Object.entries(sent.headers()).filter(([k]) => k.toLowerCase() !== 'cookie'),
  )
  const res = await other.request.fetch(sent.url(), {
    method: sent.method(),
    headers: { ...headers, Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
  })
  const body = await res.text()
  await other.close()
  return { ok: res.ok(), body }
}

test('the server function refuses a brother and a parent', async ({ page, browser }) => {
  await asAdmin(page)
  const sent = await openSettlementWeek(page)
  // Control: the admin's own replay gets the week.
  const mine = await page.request.fetch(sent.url(), {
    method: sent.method(),
    headers: sent.headers(),
  })
  expect(mine.ok()).toBe(true)
  expect(await mine.text()).toContain('totalBefore')
  for (const username of ['starsi', 'tata']) {
    const res = await replayAs(browser, sent, username)
    expect(res.ok, username).toBe(false)
    expect(res.body, username).not.toContain('Béďa')
    expect(res.body, username).not.toContain('totalBefore')
  }
})

test('an unknown week shows Nenalezeno', async ({ page }) => {
  await asAdmin(page)
  await page.goto('/sprava/tyden/9999/2')
  await expect(page.getByText(cs.notFound.message)).toBeVisible()
})
