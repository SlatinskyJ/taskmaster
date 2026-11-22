import { expect, test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// Scheduled instances (#39) at 360 px, on the `scheduler` seed: everyday templates ticked in the
// past week, then the boot tick, so they are there at any hour.

test.use({ viewport: { width: 360, height: 800 } })

test('scheduled and expired instances', async ({ page }) => {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/ukoly')
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Vyměnit kočce vodu' }).filter({
      hasText: ' · podle rozvrhu',
    }),
  ).toBeVisible()
  const expired = page
    .getByRole('region', { name: new RegExp(`^${cs.state.expired}`) })
    .getByRole('listitem')
    .filter({ hasText: 'Nakrmit rybičky' })
  await expect(expired).toHaveCount(1)
  // A finished row has no link; the seed makes the expired fish fifth (after the past week's
  // three chores and the cat's water), and the heading check fails loudly if that moves.
  await page.goto('/ukol/5')
  await expect(page.getByRole('heading', { name: 'Nakrmit rybičky' })).toBeVisible()
  await expect(page.getByRole('region', { name: cs.history.title })).toContainText(
    cs.history.expired,
  )
  await expect(page.getByRole('region', { name: cs.history.title })).toContainText(
    cs.history.scheduledCreated(1),
  )
})
