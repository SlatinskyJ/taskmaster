import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { logout, passwordLogin } from './helpers'

// The task page flows of #36 through the real routes and server functions, on the `tasks` seed (#183):
// Táta's new price 12 for "Shrabat listí na zahradě" (now 10) waits for the brothers.
const TASK = 'Shrabat listí na zahradě'

/** Starší opens the task from his "Čeká na tebe" row and lands on its page. */
async function openFromWaiting(page: Page) {
  await passwordLogin(page, 'starsi')
  const row = page
    .getByRole('listitem')
    .filter({ hasText: TASK })
    .filter({ hasText: cs.taskPrice.rowMeta(10, 12) })
  await expect(row).toBeVisible()
  await row.getByRole('link', { name: cs.bids.answer }).click()
  await expect(page.getByRole('heading', { name: TASK })).toBeVisible()
}

/** Táta logs in, waits for the app, and opens the task page. */
async function tataOpens(page: Page, url: string) {
  await passwordLogin(page, 'tata')
  await expect(page).not.toHaveURL(/\/login/)
  await page.goto(url)
  await expect(page.getByRole('heading', { name: TASK })).toBeVisible()
}

const history = (page: Page) => page.getByRole('region', { name: cs.history.title })

test('saying no, agreeing to a new price, and cancelling a task', async ({ page }) => {
  // (a) Starší says no: the proposal closes, the price stays 10.
  await openFromWaiting(page)
  await page.getByRole('button', { name: cs.taskPrice.disagree, exact: true }).click()
  await expect(page.getByText(cs.taskPrice.toast.declined)).toBeVisible()
  await expect(page.getByText(cs.taskPrice.pending, { exact: true })).toHaveCount(0)
  await expect(history(page)).toContainText(cs.history.changeDeclined(12))
  const url = page.url()
  await logout(page)

  // (b) Táta proposes 12 again; Starší agrees from his row: the task is worth 12.
  await tataOpens(page, url)
  await page.getByRole('button', { name: new RegExp(cs.taskPrice.change) }).click()
  await page.getByRole('button', { name: cs.tasks.more }).click()
  await page.getByRole('button', { name: cs.tasks.more }).click()
  await page.getByRole('button', { name: cs.taskPrice.send(12) }).click()
  await expect(page.getByText(cs.taskPrice.toast.proposed)).toBeVisible()
  await expect(page.getByText(cs.taskPrice.pending, { exact: true })).toBeVisible()
  await logout(page)
  await openFromWaiting(page)
  await page.getByRole('button', { name: cs.taskPrice.agree, exact: true }).click()
  await expect(page.getByText(cs.taskPrice.pending, { exact: true })).toHaveCount(0)
  await expect(history(page)).toContainText(cs.history.changed(12))
  await logout(page)

  // (c) Táta cancels it with a reason: Zrušeno, the reason in the history, gone from Domů.
  await tataOpens(page, url)
  await page.getByRole('button', { name: new RegExp(cs.cancelTask.hint) }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(cs.cancelTask.reason).fill('Udělá to firma.')
  await dialog.getByRole('button', { name: cs.cancelTask.confirm }).click()
  await expect(page.getByText(cs.cancelTask.done)).toBeVisible()
  await expect(page.getByText(cs.state.cancelled).first()).toBeVisible()
  await expect(history(page)).toContainText(cs.history.cancelled)
  await expect(history(page)).toContainText('„Udělá to firma.“')
  await logout(page)
  await passwordLogin(page, 'starsi')
  await expect(page.getByText(cs.home.greeting, { exact: false })).toBeVisible()
  await expect(page.getByText(TASK)).toHaveCount(0)
})

// The points dial (#190): a swipe of N gaps moves N points, with the wider gap from 99 up, and
// one gap for the whole drag when it crosses 99.
test('swiping the points dial moves one point per gap, also past 99', async ({ page }) => {
  await passwordLogin(page, 'tata')
  await expect(page).not.toHaveURL(/\/login/)
  await page.goto('/ukoly/novy')
  const dial = page.getByRole('slider').first()
  const setTo = async (target: number) => {
    await dial.focus()
    for (let i = 0; i < 300; i++) {
      const now = Number(await dial.getAttribute('aria-valuenow'))
      if (now === target) return
      await dial.press(now < target ? 'ArrowRight' : 'ArrowLeft')
    }
  }
  /** Drags left (a negative dx adds points) from the dial's centre in small steps. */
  const swipe = async (dx: number) => {
    const box = await dial.boundingBox()
    if (!box) throw new Error('no dial')
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y, { steps: 10 })
    await page.mouse.up()
  }
  await setTo(10)
  await swipe(-2 * 36)
  await expect(dial).toHaveAttribute('aria-valuenow', '12')
  await setTo(100)
  await swipe(-2 * 52)
  await expect(dial).toHaveAttribute('aria-valuenow', '102')
  // Starts at 97 (36 px gaps): three gaps take it to 100, not further.
  await setTo(97)
  await swipe(-3 * 36)
  await expect(dial).toHaveAttribute('aria-valuenow', '100')
})
