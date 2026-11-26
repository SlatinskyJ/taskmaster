import { expect, test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// Week chore copies (#257) on the `weekplan` seed: the week started today at 00:00 and "Nakrmit
// kočku" has a copy for every day left in it. Domů lists only today's; the later days' copies
// are in the database but not on Domů until their day. On a Prague Sunday the week has no later
// day, so the check still holds. Zapsat shows the chore as taken: today's copy is on the board.

test.use({ viewport: { width: 360, height: 800 } })

test("Domů lists only today's copy, and Zapsat shows the chore as taken", async ({ page }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
  // Moje and Volné: the work board (Opakované úkoly below lists the chore itself, once).
  const board = page.locator('section').filter({
    has: page.getByRole('heading', { name: new RegExp(`^(${cs.work.mine}|${cs.work.free})$`) }),
  })
  const cat = board.getByRole('listitem').filter({ hasText: 'Nakrmit kočku' })
  await expect(cat).toHaveCount(1)
  await expect(cat.getByRole('button', { name: cs.work.done, exact: true })).toBeVisible()

  await page.goto('/zapsat')
  await expect(
    page.getByRole('button', { name: cs.log.tileOnBoardLabel('Nakrmit kočku') }),
  ).toBeDisabled()
})
