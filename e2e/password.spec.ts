import { expect, test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { logout, PASSWORD, passwordLogin } from './helpers'

// Changing your own password on Profil (#210), on the `password` seed (switch on). Its own
// server: the password changes for good.

const NEW = 'noveheslo1'

test('Starší changes the password; the other device is logged out, this one stays', async ({
  browser,
}) => {
  const a = await (await browser.newContext()).newPage()
  const b = await (await browser.newContext()).newPage()
  await passwordLogin(a, 'starsi')
  await a.waitForURL((url) => !url.pathname.startsWith('/login'))
  await passwordLogin(b, 'starsi')
  await b.waitForURL((url) => !url.pathname.startsWith('/login'))

  await a.goto('/profil')
  await a.getByRole('button', { name: cs.profile.passwordRow }).click()
  const sheet = a.getByRole('dialog', { name: cs.profile.passwordTitle })
  await expect(sheet.getByRole('checkbox', { name: cs.profile.logOutOthers })).toBeChecked()

  // Return in the first two fields moves on, it doesn't send.
  const current = sheet.getByLabel(cs.profile.currentPassword, { exact: true })
  await current.fill(PASSWORD)
  await current.press('Enter')
  const next = sheet.getByLabel(cs.profile.newPassword, { exact: true })
  await expect(next).toBeFocused()
  await next.fill(NEW)
  await next.press('Enter')
  const again = sheet.getByLabel(cs.profile.newPasswordAgain, { exact: true })
  await expect(again).toBeFocused()

  // A mismatch is caught before sending.
  await again.fill('jineheslo1')
  await sheet.getByRole('button', { name: cs.profile.passwordSubmit }).click()
  await expect(sheet.getByRole('alert')).toHaveText(cs.profile.passwordErrors.mismatch)

  // Return in the last field sends.
  await again.fill(NEW)
  await again.press('Enter')
  await expect(a.getByText(cs.profile.passwordChangedOthers)).toBeVisible()
  await expect(sheet).toBeHidden()

  await b.reload()
  await expect(b).toHaveURL(/\/login/)
  await a.reload()
  await expect(a).toHaveURL(/\/profil/)

  await logout(a)
  await passwordLogin(a, 'starsi')
  await expect(a.getByRole('alert')).toBeVisible()
  await a.goto('/login')
  await a.getByLabel(cs.login.username).fill('starsi')
  await a.getByLabel(cs.login.password).fill(NEW)
  await a.getByRole('button', { name: cs.login.submit, exact: true }).click()
  await a.waitForURL((url) => !url.pathname.startsWith('/login'))
})

test('refused, then a network error, then a change with the box unticked keeps the other device', async ({
  browser,
}) => {
  const page = await (await browser.newContext()).newPage()
  const other = await (await browser.newContext()).newPage()
  await passwordLogin(page, 'mladsi')
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await passwordLogin(other, 'mladsi')
  await other.waitForURL((url) => !url.pathname.startsWith('/login'))

  await page.goto('/profil')
  await page.getByRole('button', { name: cs.profile.passwordRow }).click()
  const sheet = page.getByRole('dialog', { name: cs.profile.passwordTitle })
  const current = sheet.getByLabel(cs.profile.currentPassword, { exact: true })
  const send = sheet.getByRole('button', { name: cs.profile.passwordSubmit })
  await current.fill('spatne-heslo')
  await sheet.getByLabel(cs.profile.newPassword, { exact: true }).fill(NEW)
  await sheet.getByLabel(cs.profile.newPasswordAgain, { exact: true }).fill(NEW)
  await send.click()
  await expect(sheet.getByRole('alert')).toHaveText(cs.profile.passwordErrors.wrong)
  // Not stuck busy: the button can be pressed again.
  await expect(send).toBeEnabled()

  // The server can't be reached: a Czech message, and the form can be sent again.
  await current.fill(PASSWORD)
  await page.route('**/_serverFn/**', (route) => route.abort())
  await send.click()
  await expect(sheet.getByRole('alert')).toHaveText(cs.login.failed)
  await page.unroute('**/_serverFn/**')
  await expect(send).toBeEnabled()

  const box = sheet.getByRole('checkbox', { name: cs.profile.logOutOthers })
  await box.uncheck()
  await send.click()
  await expect(page.getByText(cs.profile.passwordChanged, { exact: true })).toBeVisible()

  await other.reload()
  await expect(other.getByRole('link', { name: cs.profile.open })).toBeVisible()
  await expect(other).not.toHaveURL(/\/login/)
})
