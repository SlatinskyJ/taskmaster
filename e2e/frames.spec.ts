import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { PASSWORD, passwordLogin } from './helpers'

// Viewer frames (#265): on a preview, a frame named `tm-frame:<token>` carries its own session
// and leaves the page's cookie alone. Also pins that adding src/start.ts kept the CSRF check.

const hello = (name: string) => `${cs.home.greeting}, ${name}!`

async function signedInAsTata(page: Page) {
  await passwordLogin(page, 'tata')
  await expect(page.getByRole('heading', { name: hello('Táta') })).toBeVisible()
}

/** Adds the viewer's kind of frame to the page, nobody signed in yet. */
async function addFrame(page: Page) {
  await page.evaluate(() => {
    const frame = document.createElement('iframe')
    frame.id = 'viewer'
    frame.name = 'tm-frame:'
    frame.src = '/login?tmFrame=-'
    frame.style.width = '400px'
    frame.style.height = '700px'
    document.body.prepend(frame)
  })
  return page.frameLocator('#viewer')
}

async function frameLogin(page: Page, username = 'starsi', heading = hello('Starší')) {
  const frame = await addFrame(page)
  await frame.getByLabel(cs.login.username).fill(username)
  await frame.getByLabel(cs.login.password).fill(PASSWORD)
  await frame.getByRole('button', { name: cs.login.submit, exact: true }).click()
  await expect(frame.getByRole('heading', { name: heading })).toBeVisible()
  return frame
}

/** The frame's session token, from its window name. */
async function frameToken(page: Page): Promise<string> {
  const name = await page.evaluate(
    () => (document.getElementById('viewer') as HTMLIFrameElement).contentWindow?.name ?? '',
  )
  expect(name.startsWith('tm-frame:')).toBe(true)
  const token = name.slice('tm-frame:'.length)
  expect(token).toHaveLength(43)
  return token
}

/**
 * Counts the viewer frame's document loads from now on: its navigation requests, a redirect hop
 * counted with the load it belongs to. (`framenavigated` also fires for the router's
 * same-document history updates, so it counts about two per load.)
 */
function countFrameLoads(page: Page): () => number {
  let loads = 0
  page.on('request', (request) => {
    if (!request.isNavigationRequest() || request.redirectedFrom()) return
    if (request.frame().name().startsWith('tm-frame:')) loads += 1
  })
  return () => loads
}

/** Points the viewer frame at `src`. */
async function openInFrame(page: Page, src: string) {
  await page.evaluate((to) => {
    ;(document.getElementById('viewer') as HTMLIFrameElement).src = to
  }, src)
}

const frameHref = (page: Page) =>
  page.evaluate(
    () => (document.getElementById('viewer') as HTMLIFrameElement).contentWindow?.location.href,
  )

test('a cross-site server function call is refused', async ({ page, request }) => {
  const call = page.waitForRequest((r) => r.url().includes('/_serverFn/') && r.method() === 'POST')
  await signedInAsTata(page)
  const sent = await call
  const replay = (headers: Record<string, string>) =>
    request.post(sent.url(), {
      headers: { 'content-type': sent.headers()['content-type'] ?? '', ...headers },
      data: sent.postData() ?? '',
    })
  const origin = new URL(sent.url()).origin
  // Control: the same call from the app's own origin goes through.
  expect((await replay({ Origin: origin, 'Sec-Fetch-Site': 'same-origin' })).status()).not.toBe(403)
  expect(
    (await replay({ Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' })).status(),
  ).toBe(403)
})

test('logging in inside a frame logs in that frame only', async ({ page }) => {
  await signedInAsTata(page)
  await frameLogin(page)

  await page.reload()
  await expect(page.getByRole('heading', { name: hello('Táta') })).toBeVisible()

  // Reloaded without the token in the URL, as the service worker does after a redeploy: the
  // frame finds its token in its name and comes back as the same person.
  const frame = await addFrameReloadedWithoutQuery(page)
  // The re-entry happened (not the old page still showing): the URL now carries the token.
  await expect
    .poll(() =>
      page.evaluate(
        () => (document.getElementById('viewer') as HTMLIFrameElement).contentWindow?.location.href,
      ),
    )
    .toMatch(/\/\?tmFrame=[A-Za-z0-9_-]{43}$/)
  await expect(frame.getByRole('heading', { name: hello('Starší') })).toBeVisible()
})

/** Logs a frame in, then points it at `/` with no `tmFrame`. */
async function addFrameReloadedWithoutQuery(page: Page) {
  const frame = await frameLogin(page)
  await page.evaluate(() => {
    const el = document.getElementById('viewer') as HTMLIFrameElement
    el.src = '/'
  })
  return frame
}

test('logout inside a frame leaves the page logged in', async ({ page }) => {
  await signedInAsTata(page)
  const frame = await frameLogin(page)
  await frame.getByRole('link', { name: cs.profile.open }).click()
  await frame.getByRole('button', { name: cs.login.logout }).click()
  await expect(frame.getByLabel(cs.login.username)).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: hello('Táta') })).toBeVisible()
})

test('an admin frame opened at / ends on Správa, logged in', async ({ page }) => {
  await signedInAsTata(page)
  const frame = await frameLogin(page, 'admin', cs.admin.title)
  const token = await frameToken(page)
  const loads = countFrameLoads(page)
  await openInFrame(page, `/?tmFrame=${token}`)
  await expect(frame.getByRole('heading', { name: cs.admin.title })).toBeVisible()
  await expect.poll(() => frameHref(page)).toMatch(/\/sprava\?tmFrame=[A-Za-z0-9_-]{43}$/)
  await page.waitForTimeout(1000)
  expect(loads()).toBeLessThanOrEqual(2)

  await page.reload()
  await expect(page.getByRole('heading', { name: hello('Táta') })).toBeVisible()
})

test('a logged-in frame that opens /login lands on its landing page, logged in', async ({
  page,
}) => {
  await signedInAsTata(page)
  const frame = await frameLogin(page)
  const loads = countFrameLoads(page)
  await openInFrame(page, '/login')
  await expect(frame.getByRole('heading', { name: hello('Starší') })).toBeVisible()
  await expect.poll(() => frameHref(page)).toMatch(/\/\?tmFrame=[A-Za-z0-9_-]{43}$/)
  await page.waitForTimeout(1000)
  expect(loads()).toBeLessThanOrEqual(3)
})

test('a logged-in frame redirected from /login keeps its token', async ({ page }) => {
  await signedInAsTata(page)
  const frame = await frameLogin(page)
  const token = await frameToken(page)
  const loads = countFrameLoads(page)
  await openInFrame(page, `/login?tmFrame=${token}`)
  await expect.poll(() => frameHref(page)).toMatch(/\/\?tmFrame=[A-Za-z0-9_-]{43}$/)
  await expect(frame.getByRole('heading', { name: hello('Starší') })).toBeVisible()
  await page.waitForTimeout(1000)
  // One load: the server's redirect kept the token, so the client had nothing to re-enter.
  expect(loads()).toBe(1)
})
