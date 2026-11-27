import { expect, test, type Browser, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// The live change banner (#299) through the real stream, in three browsers: Táta (A) on a task
// page with Zrušit úkol? open, Starší (B) changing that task, and Starší again on a second phone
// (C). The `demo` seed has the liveChanges switch on. One test: it changes the suite's data.

const FREE = 'Umýt okna v obýváku i v ložnici'
const reserved = (who: string) => `${who} · ${cs.history.reserved} · ${FREE}`
const released = (who: string) => `${who} · ${cs.history.released} · ${FREE}`

const banner = (page: Page) =>
  page.locator('[data-sonner-toast]').filter({
    has: page.getByRole('button', { name: cs.live.banner.refresh, includeHidden: true }),
  })

/** Resolves once the page's live stream answered 200. */
const streamOpen = (page: Page) =>
  page.waitForResponse((r) => r.url().includes('/api/live') && r.status() === 200, {
    timeout: 15_000,
  })

async function signedIn(browser: Browser, who: string): Promise<Page> {
  const page = await (await browser.newContext({ locale: 'cs-CZ' })).newPage()
  await passwordLogin(page, who)
  await expect(page).toHaveURL(/\/$/)
  return page
}

/** Opens FREE's page from the given list and waits for its stream. */
async function openFree(page: Page, from: string) {
  await page.goto(from)
  const open = streamOpen(page)
  await page.getByRole('link', { name: FREE, exact: true }).first().click()
  await expect(page.getByRole('heading', { name: FREE })).toBeVisible()
  await open
}

test('the banner shows other people’s changes, refreshes in place and counts', async ({
  browser,
}) => {
  test.setTimeout(120_000)
  const a = await signedIn(browser, 'tata')
  const b = await signedIn(browser, 'starsi')
  const c = await signedIn(browser, 'starsi')
  const dialog = a.getByRole('dialog', { name: cs.cancelTask.title })
  const reason = dialog.getByLabel(cs.cancelTask.reason)

  await test.step('A opens the task and types a reason; B and C wait on their screens', async () => {
    await openFree(a, '/ukoly')
    await a.getByRole('button', { name: new RegExp(cs.cancelTask.hint) }).click()
    await reason.fill('Napůl napsaný důvod')
    await expect(reason).toBeFocused()
    await openFree(b, '/')
    const cOpen = streamOpen(c)
    await c.reload()
    await cOpen
    await a.evaluate(() => {
      ;(window as unknown as { __marker: string }).__marker = 'kept'
    })
  })

  await test.step('B reserves: C and A get it at once, B (own tab) does not', async () => {
    await b.getByRole('button', { name: cs.work.reserve, exact: true }).click()
    await expect(b.getByRole('button', { name: cs.work.release, exact: true })).toBeVisible()
    await expect(banner(c)).toHaveText(reserved(cs.live.you))
    // The reason still has focus: the banner shows anyway (Jakub 2026-11-27, Q2).
    await expect(banner(a)).toHaveText(reserved('Starší'))
    await expect(reason).toBeFocused()
    await expect(reason).toHaveValue('Napůl napsaný důvod')
    await expect(banner(b)).toHaveCount(0)
  })

  await test.step('A closes the banner with the dialog open: the dialog and the reason stay', async () => {
    await banner(a).getByRole('button', { name: cs.live.banner.close }).click()
    await expect(banner(a)).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await expect(reason).toHaveValue('Napůl napsaný důvod')
    await b.getByRole('button', { name: cs.work.release, exact: true }).click()
    await expect(b.getByRole('button', { name: cs.work.reserve, exact: true })).toBeVisible()
    await b.getByRole('button', { name: cs.work.reserve, exact: true }).click()
    await expect(b.getByRole('button', { name: cs.work.release, exact: true })).toBeVisible()
    await expect(banner(a)).toHaveText(cs.live.banner.many(3))
  })

  await test.step('A refreshes with the dialog open: the dialog and the reason stay', async () => {
    const loads = await a.evaluate(() => performance.getEntriesByType('navigation').length)
    await banner(a).getByRole('button', { name: cs.live.banner.refresh }).click()
    await expect(banner(a)).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await expect(reason).toHaveValue('Napůl napsaný důvod')
    await a.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(a.getByText(`${cs.work.reservedBy} Starší`)).toBeVisible()
    expect(await a.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(loads)
    expect(await a.evaluate(() => (window as unknown as { __marker?: string }).__marker)).toBe(
      'kept',
    )
  })

  await test.step('the count runs from the refresh, through a swipe and a close', async () => {
    await b.getByRole('button', { name: cs.work.release, exact: true }).click()
    await expect(b.getByRole('button', { name: cs.work.reserve, exact: true })).toBeVisible()
    await b.getByRole('button', { name: cs.work.reserve, exact: true }).click()
    await expect(b.getByRole('button', { name: cs.work.release, exact: true })).toBeVisible()
    await expect(banner(a)).toHaveText(cs.live.banner.many(2))

    const box = await banner(a).boundingBox()
    if (!box) throw new Error('no banner box')
    await a.mouse.move(box.x + 24, box.y + box.height / 2)
    await a.mouse.down()
    await a.mouse.move(box.x + 24, box.y + box.height / 2 - 50, { steps: 5 })
    await a.mouse.move(box.x + 24, box.y + box.height / 2 - 100, { steps: 5 })
    await a.mouse.up()
    await expect(banner(a)).toHaveCount(0)

    await b.getByRole('button', { name: cs.work.release, exact: true }).click()
    await expect(b.getByRole('button', { name: cs.work.reserve, exact: true })).toBeVisible()
    await expect(banner(a)).toHaveText(cs.live.banner.many(3))
    await banner(a).getByRole('button', { name: cs.live.banner.close }).click()
    await expect(banner(a)).toHaveCount(0)

    await b.getByRole('button', { name: cs.work.reserve, exact: true }).click()
    await expect(b.getByRole('button', { name: cs.work.release, exact: true })).toBeVisible()
    await expect(banner(a)).toHaveText(cs.live.banner.many(4))
  })

  await test.step('navigation starts the count again', async () => {
    const open = streamOpen(a)
    await a.getByRole('link', { name: cs.nav.tasks }).click()
    await expect(a).toHaveURL(/\/ukoly/)
    await expect(banner(a)).toHaveCount(0)
    await open
    await b.getByRole('button', { name: cs.work.release, exact: true }).click()
    await expect(banner(a)).toHaveText(released('Starší'))
  })
})
