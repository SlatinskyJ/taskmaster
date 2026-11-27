import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { TASK_TITLE_MAX } from '../src/lib/taskLimits'
import { passwordLogin } from './helpers'
import { openKeyboard, PHONE_BROWSER, useKeyboard } from './keyboard'

// The live change banner (#299) through the real <LiveBanner />, fed by a scripted stream
// (`page.route`): over the phone keyboard, over a sheet, its reconnect, overflow, a screen with
// no subscriptions, and its layout at 360 px. Read-only: forms are opened, never sent; the
// `demo` seed has the liveChanges switch on.

const FREE = 'Umýt okna v obýváku i v ložnici'
const VACUUM = 'Vyluxovat celý obývák a chodbu'

const banner = (page: Page) =>
  page.locator('[data-sonner-toast]').filter({
    has: page.getByRole('button', { name: cs.live.banner.refresh, includeHidden: true }),
  })

interface Frame {
  id: number
  change?: number
  text?: string
}

const frame = ({ id, change = id, text = `Starší · změna ${String(id)}` }: Frame) =>
  `id: ${String(id)}\ndata: ${JSON.stringify({
    id,
    change,
    action: 'task.reserved',
    entityType: 'task',
    entityId: '1',
    actor: { kind: 'user', userId: 3 },
    at: '2026-11-27T10:00:00.000Z',
    text,
  })}\n\n`

/**
 * Answers the page's `/api/live` requests in order: each queued body after `: open`, then
 * `: open` alone. Every answer ends, so the tab reconnects (after 1 s) and takes the next one.
 */
async function scriptStream(page: Page) {
  const urls: string[] = []
  const queue: string[] = []
  await page.route('**/api/live**', async (route) => {
    urls.push(route.request().url())
    const next = queue.shift()
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
      body: ': open\n\n' + (next ?? ''),
    })
  })
  return {
    urls,
    /** The next request answers this body. */
    now(body: string) {
      queue.push(body)
    },
  }
}

async function login(page: Page) {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
}

async function openTask(page: Page, title: string) {
  await page.goto('/ukoly')
  await page.getByRole('link', { name: title, exact: true }).first().click()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
}

test.describe('on a phone, with the keyboard', () => {
  const { keyboard, ...viewport } = PHONE_BROWSER
  test.use({ viewport, isMobile: true, hasTouch: true })

  test('Zrušit úkol? with the keyboard open: the banner shows at once; Zavřít keeps the dialog', async ({
    page,
  }) => {
    await useKeyboard(page, keyboard)
    const stream = await scriptStream(page)
    await login(page)
    await openTask(page, FREE)
    await page.getByRole('button', { name: new RegExp(cs.cancelTask.hint) }).click()
    const dialog = page.getByRole('dialog', { name: cs.cancelTask.title })
    const field = dialog.getByLabel(cs.cancelTask.reason)
    await openKeyboard(page, field)
    await field.pressSequentially('Napůl napsaný')
    // The tab's next reconnect (every answer ends) brings the change.
    stream.now(frame({ id: 5, text: `Starší · rezervace · ${FREE}` }))
    await expect(banner(page)).toHaveText(`Starší · rezervace · ${FREE}`)
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('Napůl napsaný')
    await page.screenshot({ path: 'test-results/banner-keyboard.png', animations: 'disabled' })
    await banner(page).getByRole('button', { name: cs.live.banner.close }).tap()
    await expect(banner(page)).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await expect(field).toHaveValue('Napůl napsaný')
  })

  test('Změnit cenu sheet: Načíst změny keeps the sheet and its price', async ({ page }) => {
    await useKeyboard(page, keyboard)
    const stream = await scriptStream(page)
    await login(page)
    await openTask(page, VACUUM)
    await page.getByRole('button', { name: new RegExp(`^${cs.taskPrice.change}`) }).click()
    const sheet = page.getByRole('dialog', { name: cs.taskPrice.change })
    await sheet.getByRole('button', { name: cs.tasks.more, exact: true }).tap()
    await sheet.getByRole('button', { name: cs.tasks.more, exact: true }).tap()
    await expect(sheet.getByRole('button', { name: cs.taskPrice.send(10) })).toBeVisible()
    stream.now(frame({ id: 5 }))
    await expect(banner(page)).toHaveText('Starší · změna 5')
    await banner(page).getByRole('button', { name: cs.live.banner.refresh }).tap()
    await expect(banner(page)).toHaveCount(0)
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('button', { name: cs.taskPrice.send(10) })).toBeVisible()
  })
})

test.describe('the stream', () => {
  test('a lost stream reconnects with since and keeps counting', async ({ page }) => {
    const stream = await scriptStream(page)
    stream.now(frame({ id: 5 }))
    stream.now(frame({ id: 6 }))
    await login(page)
    await expect(banner(page)).toHaveText(cs.live.banner.many(2), { timeout: 5_000 })
    expect(stream.urls.length).toBeGreaterThanOrEqual(2)
    expect(new URL(stream.urls[0] ?? '').searchParams.get('since')).toBeNull()
    expect(new URL(stream.urls[1] ?? '').searchParams.get('since')).toBe('5')
  })

  test('overflow: Více změn (100+)', async ({ page }) => {
    const stream = await scriptStream(page)
    stream.now('id: 9\nevent: overflow\ndata: {}\n\n')
    await login(page)
    await expect(banner(page)).toHaveText(cs.live.banner.overflow)
  })

  test('two changes count two; the same change replayed on the next connection counts once', async ({
    page,
  }) => {
    const stream = await scriptStream(page)
    stream.now(frame({ id: 5, text: 'Starší · jedna' }))
    stream.now(frame({ id: 5, text: 'Starší · jedna' }))
    stream.now(frame({ id: 6, change: 4 }) + frame({ id: 7, change: 5 }))
    await login(page)
    await expect(banner(page)).toHaveText('Starší · jedna')
    await expect.poll(() => stream.urls.length).toBeGreaterThanOrEqual(3)
    await expect(banner(page)).toHaveText(cs.live.banner.many(2))
  })

  test('a screen with no subscriptions (Nový úkol): the banner goes and no stream opens', async ({
    page,
  }) => {
    const stream = await scriptStream(page)
    await login(page)
    await page.goto('/ukoly')
    stream.now(frame({ id: 5 }))
    await expect(banner(page)).toBeVisible()
    await page.getByRole('link', { name: cs.tasks.new }).click()
    await expect(page).toHaveURL(/\/ukoly\/novy/)
    await expect(banner(page)).toHaveCount(0)
    const before = stream.urls.length
    await page.waitForTimeout(3_000)
    expect(stream.urls.length).toBe(before)
  })
})

test.describe('at 360 px', () => {
  test.use({ viewport: { width: 360, height: 800 } })

  const LONG_TITLE = 'Vyluxovat celý obývák, chodbu, schody a pak ještě pokoj kluků'.padEnd(
    TASK_TITLE_MAX,
    ' a půdu',
  )

  for (const [name, text] of [
    ['the giver sentence', `Táta · domluveno za 8 b · rezervace: Starší · ${VACUUM}`],
    ['an 80-letter title', `Táta · domluveno za 8 b · rezervace: Starší · ${LONG_TITLE}`],
  ] as const) {
    test(`${name}: wraps whole inside the screen, both buttons 44 px`, async ({ page }) => {
      expect(LONG_TITLE).toHaveLength(TASK_TITLE_MAX)
      const stream = await scriptStream(page)
      stream.now(frame({ id: 5, text }))
      await login(page)
      const b = banner(page)
      await expect(b).toHaveText(text)
      // Sonner slides the toast in from above: measure once it has arrived.
      await expect(b).toHaveAttribute('data-mounted', 'true')
      await b.evaluate((el) =>
        Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
      )
      // The slide-in transition may not have started when data-mounted flips: wait until it lands.
      await expect.poll(async () => (await b.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0)
      const box = await b.boundingBox()
      if (!box) throw new Error('no banner')
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(360)
      expect(box.y + box.height).toBeLessThanOrEqual(800)
      const fit = await b.locator('[data-live-text]').evaluate((el) => ({
        text: el.textContent,
        w: el.scrollWidth <= el.clientWidth,
        h: el.scrollHeight <= el.clientHeight,
      }))
      expect(fit).toEqual({ text, w: true, h: true })
      for (const label of [cs.live.banner.refresh, cs.live.banner.close]) {
        const btn = await b.getByRole('button', { name: label }).boundingBox()
        if (!btn) throw new Error(`no ${label}`)
        expect(btn.width).toBeGreaterThanOrEqual(44)
        expect(btn.height).toBeGreaterThanOrEqual(44)
        expect(btn.x + btn.width).toBeLessThanOrEqual(360)
        expect(btn.y).toBeGreaterThanOrEqual(0)
      }
      if (name === 'the giver sentence') {
        await page.screenshot({ path: 'test-results/banner-giver-360.png', animations: 'disabled' })
      }
    })
  }
})
