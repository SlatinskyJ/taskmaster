import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { bottomBar, passwordLogin } from './helpers'
import { PHONE } from './keyboard'

// The week plan at Schůzka (#259) on the `planmeeting` seed: the running week is on its last day
// (any weekday, last-day rule on), with the plan table's chores. Táta settles it, a new week
// starts with its copies, and step 3 shows the plan table under the open tasks. Starší reserves
// and frees a cell on his phone, and Obnovit shows it. Leaving and coming back the same day keeps
// the table.
// One test: each step builds on the one before.

test.use({ viewport: PHONE })

const TABLE = 'Prostřít stůl k večeři'
const m = cs.meeting

const planSection = (page: Page) => page.getByRole('region', { name: cs.plan.title })

/** Counts the plan's server-function answers (GET, a body with the table's rows). */
function countPlanRequests(page: Page): { count: number } {
  const seen = { count: 0 }
  page.on('response', (r) => {
    if (!r.url().includes('/_serverFn/') || r.request().method() !== 'GET') return
    void r
      .text()
      .then((body) => {
        if (body.includes('scheduleDays')) seen.count++
      })
      .catch(() => undefined)
  })
  return seen
}

test('Táta settles, sees the plan, Obnovit shows Starší’s reserve and release, and the table stays the same day', async ({
  page,
  browser,
}) => {
  const plans = countPlanRequests(page)
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/schuzka')

  // Step 1: nothing to approve, no plan yet.
  await expect(page.getByText(m.allClear)).toBeVisible()
  await expect(planSection(page)).toHaveCount(0)
  expect(plans.count).toBe(0)
  await page.getByRole('button', { name: m.next }).click()
  await page.getByRole('button', { name: m.confirm }).click()
  await page.getByRole('button', { name: m.confirmYes, exact: true }).click()

  // Step 3: a new week starts now; the plan sits below the open tasks.
  await expect(page.getByText(new RegExp(`^${m.newWeek} `))).toBeVisible()
  await expect(page.getByText(m.stillRunning)).toHaveCount(0)
  const section = planSection(page)
  await expect(section).toBeVisible()
  await expect(section.getByRole('button', { name: m.refresh })).toBeVisible()
  const tasksBox = await page.getByRole('heading', { name: m.planTasks }).boundingBox()
  const planBox = await section.boundingBox()
  expect(planBox?.y ?? 0).toBeGreaterThan(tasksBox?.y ?? Infinity)
  await expect.poll(() => plans.count).toBe(1)
  const week = await section.locator('p.num').first().textContent()

  const cell = section.locator(`button[aria-label^="${TABLE}, "][aria-label$=": volné"]`).first()
  const day = await cell.getAttribute('data-day')
  expect(day).not.toBeNull()
  const tataCell = section.locator(`button[data-day="${day ?? ''}"][aria-label^="${TABLE}, "]`)
  await expect(tataCell).toHaveAttribute('aria-label', /: volné$/)

  // Starší reserves that day on his own phone.
  const other = await browser.newContext({ viewport: PHONE, locale: 'cs-CZ' })
  const brother = await other.newPage()
  await passwordLogin(brother, 'starsi')
  await expect(brother).toHaveURL(/\/$/)
  await brother.goto('/tyden/plan')
  const his = brother.locator(`button[data-day="${day ?? ''}"][aria-label^="${TABLE}, "]`)
  await expect(his).toHaveAttribute('aria-label', /: volné, rezervovat$/)
  await his.click()
  await expect(his).toHaveAttribute('aria-label', /: rezervováno tebou, uvolnit$/)

  // Táta's table does not refresh by itself; Obnovit does.
  await expect(tataCell).toHaveAttribute('aria-label', /: volné$/)
  const refresh = section.getByRole('button', { name: m.refresh })
  await refresh.click()
  await expect(tataCell).toHaveAttribute('aria-label', /: rezervováno, Starší$/)
  await expect(refresh).toBeEnabled()

  // Starší frees it; a second Obnovit shows that.
  await his.click()
  const sheet = brother.getByRole('dialog')
  await sheet.getByRole('button', { name: cs.work.release, exact: true }).click()
  await expect(his).toHaveAttribute('aria-label', /: volné, rezervovat$/)
  await other.close()
  await refresh.click()
  await expect(tataCell).toHaveAttribute('aria-label', /: volné$/)
  await expect(refresh).toBeEnabled()

  // Leave and come back the same day: the new week runs, and the table is there again.
  await bottomBar(page).getByRole('link', { name: cs.nav.week }).click()
  await expect(page).toHaveURL(/\/tyden$/)
  await bottomBar(page).getByRole('link', { name: cs.nav.meeting }).click()
  await expect(page).toHaveURL(/\/schuzka$/)
  await expect(page.getByText(m.notYet)).toBeVisible()
  await expect(planSection(page)).toBeVisible()
  await expect(planSection(page).locator('p.num').first()).toHaveText(week ?? '')

  // A parent's tap opens the copy's task page.
  await planSection(page)
    .locator(`button[data-day="${day ?? ''}"][aria-label^="${TABLE}, "]`)
    .click()
  await expect(page).toHaveURL(/\/ukol\/\d+$/)
})
