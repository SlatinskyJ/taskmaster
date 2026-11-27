import { expect, test, type Page } from '@playwright/test'
import { passwordLogin } from './helpers'

// Live change notices, server side (#299): the real stream route, and the tokens the screens
// sign into their pages. The `demo` seed turns the `liveChanges` switch on; the 404 with the switch
// off is in launch.spec.ts (every switch off). The two-browser e2e comes with the banner (PR 4).

test('GET /api/live without a session is 401', async ({ request }) => {
  const res = await request.get('/api/live?tab=x')
  expect(res.status()).toBe(401)
  expect(res.headers()['cache-control']).toBe('no-store')
})

test('GET /api/live signed in but without a subscription token is 401', async ({ page }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  expect((await page.request.get('/api/live?tab=x')).status()).toBe(401)
  expect((await page.request.get('/api/live?tab=x&t=forged.token')).status()).toBe(401)
})

// Through the real route (#299, PR 2): a screen's loader signs its subscriptions into the page;
// the stream accepts exactly those, for the login that loaded them.

/** The signed subscription tokens a page's HTML carries: `<base64url payload>.<43-char HMAC>`. */
const TOKEN = /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g

async function tokensOf(page: Page): Promise<string[]> {
  const html = await (await page.request.get('/')).text()
  return [...new Set(html.match(TOKEN) ?? [])]
}

/** Opens the stream from the page with these tokens; resolves with its status once headers arrive. */
function openFrom(page: Page, tokens: string[]) {
  const params = new URLSearchParams([...tokens.map((t) => ['t', t]), ['tab', 'e2e']]).toString()
  return page.evaluate(async (query) => {
    const abort = new AbortController()
    const res = await fetch(`/api/live?${query}`, { signal: abort.signal })
    const out = { status: res.status, type: res.headers.get('content-type') }
    abort.abort()
    return out
  }, params)
}

test("a screen's real tokens open the stream", async ({ page }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  const tokens = await tokensOf(page)
  expect(tokens.length).toBeGreaterThan(0)
  const res = await openFrom(page, tokens)
  expect(res.status).toBe(200)
  expect(res.type).toContain('text/event-stream')
})

test("another login's tokens are refused", async ({ page, browser }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  const tokens = await tokensOf(page)
  expect(tokens.length).toBeGreaterThan(0)
  const other = await browser.newContext()
  try {
    const mladsi = await other.newPage()
    await passwordLogin(mladsi, 'mladsi')
    await expect(mladsi).toHaveURL(/\/$/)
    expect((await openFrom(mladsi, tokens)).status).toBe(401)
  } finally {
    await other.close()
  }
})
