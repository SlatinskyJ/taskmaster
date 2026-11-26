import { expect, test } from '@playwright/test'
import { passwordLogin } from './helpers'

// Live change notices, server side (#299): no screen subscribes yet, so this only checks the
// real server route. The `demo` seed turns the `liveChanges` switch on; the 404 with the switch
// off is in launch.spec.ts (every switch off). The two-browser e2e comes with the banner (PR 2).

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
