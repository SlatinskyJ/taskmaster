import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// Taker Domů (#40) and parent Domů and Úkoly (#41) on the demo seed, through the built server: the points card comes from
// getPointsFn and the real database, and Hotovo on an open task needs no reservation.

test.use({ viewport: { width: 360, height: 800 } })
// One seeded database for the whole file: the parent's test continues from the boys' tests.
test.describe.configure({ mode: 'serial' })

const bar = (page: Page) => page.locator('[data-slot="points-bar"]').first()

test('taker sees his points and marks an open task done', async ({ page }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  await expect(bar(page)).toHaveAttribute('aria-label', /^152 bodů potvrzeno, 14 čeká/)
  await expect(page.getByText(cs.points.upperDone)).toBeVisible()

  // Nothing floats on first load; the "+5" shows where Hotovo was tapped.
  await expect(page.locator('.animate-float-up')).toHaveCount(0)
  const row = page.getByRole('listitem').filter({ hasText: 'Umýt okna v obýváku i v ložnici' })
  await row.getByRole('button', { name: cs.work.done, exact: true }).click()
  await expect(page.getByText(cs.work.toast.pending)).toBeVisible()
  await expect(page.locator('.animate-float-up', { hasText: '+5' })).toBeVisible()
  await expect(bar(page)).toHaveAttribute('aria-label', /^152 bodů potvrzeno, 19 čeká/)
})

test('the brother’s points are not on his Domů', async ({ page }) => {
  await passwordLogin(page, 'mladsi')
  await expect(page).toHaveURL(/\/$/)
  await expect(bar(page)).toHaveAttribute('aria-label', /^102 bodů potvrzeno, 3 čeká/)
  await expect(page.getByText(cs.points.upperDone)).toBeVisible()
  await expect(page.locator('[data-slot="points-bar"]')).toHaveCount(1)
})

test('a parent sees both boys’ points, approves completions and sees Úkoly by state', async ({
  page,
}) => {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText(cs.points.takersTitle)).toBeVisible()
  const bars = page.locator('[data-slot="points-bar"]')
  await expect(bars).toHaveCount(2)
  await expect(bars.nth(0)).toHaveAttribute('aria-label', /^152 bodů potvrzeno, 19 čeká/)
  await expect(bars.nth(1)).toHaveAttribute('aria-label', /^102 bodů potvrzeno, 3 čeká/)
  const waitingOnBoys = page.getByRole('region', { name: /Čeká na kluky/ })
  await expect(waitingOnBoys.getByText('Uklidit sklep')).toBeVisible()

  const approve = (title: string) =>
    page
      .getByRole('listitem')
      .filter({ hasText: title })
      .getByRole('button', { name: cs.work.approve })
  await approve('Vytřít podlahu v kuchyni').click()
  await expect(page.locator('.animate-float-up', { hasText: '+12' })).toBeVisible()
  await expect(bars.nth(0)).toHaveAttribute('aria-label', /^164 bodů potvrzeno, 7 čeká/)
  // The +5 still floats (the app-wide layer); the demo week's two chores stay for the meeting.
  await approve('Umýt okna v obýváku i v ložnici').click()
  await expect(page.locator('.animate-float-up', { hasText: '+5' })).toBeVisible()
  await expect(approve('Zalít kytky')).toBeVisible()
  await expect(bars.nth(0)).toHaveAttribute('aria-label', /^169 bodů potvrzeno, 2 čeká/)

  await page.goto('/ukoly')
  const labels = await page.locator('[id^="group-"]').allTextContents()
  expect(labels.map((l) => l.replace(/ \(\d+\)$/, ''))).toEqual([
    cs.tasks.groupProposed,
    cs.state.reserved,
    cs.state.pending,
    cs.state.confirmed,
  ])
})
