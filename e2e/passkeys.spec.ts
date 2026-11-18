import { expect, test, type Page } from '@playwright/test'
import { cs, formatKeys } from '../src/lib/strings'
import { bottomBar, logout, passwordLogin } from './helpers'

// Passkeys on (WEBAUTHN_RP_ID=localhost): one ordered story on one database, with Chromium's
// virtual authenticator standing in for Face ID; it says yes to every ceremony on its own.
// The username field's autofill is switched off here: the authenticator would answer it at
// once and race the button. The autofill rules are unit-tested (createLoginFlow).

async function addAuthenticator(page: Page) {
  await page.addInitScript(() => {
    PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false)
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
}

const SERVER_FN = '**/_serverFn/**'

async function pressPasskeyButton(page: Page) {
  await page.getByRole('button', { name: cs.passkeys.loginButton }).click()
}

async function enrolFromOffer(page: Page) {
  await expect(page).toHaveURL(/\/klic/)
  await page.getByRole('button', { name: cs.passkeys.offerSet }).click()
  await expect(page.getByText(cs.passkeys.added)).toBeVisible()
}

test('passkey story', async ({ page, browser, baseURL }) => {
  await addAuthenticator(page)

  // 1. The button and its hint; a first password login offers a passkey, with no bottom bar.
  await page.goto('/login')
  await expect(page.getByRole('button', { name: cs.passkeys.loginButton })).toBeVisible()
  await expect(page.getByText(cs.passkeys.hint)).toBeVisible()
  await expect(page.getByLabel(cs.login.username)).toHaveAttribute(
    'autocomplete',
    'username webauthn',
  )
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/klic/)
  await expect(page.getByText(cs.passkeys.offerText)).toBeVisible()
  await expect(bottomBar(page)).toHaveCount(0)
  await enrolFromOffer(page)
  await expect(page).toHaveURL(/\/$/)
  await expect(bottomBar(page)).toBeVisible()

  // 2. Profil lists it, never used yet.
  await page.goto('/profil')
  await expect(page.getByText(cs.passkeys.section)).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: cs.passkeys.neverUsed })).toHaveCount(1)
  // This browser added it: the row says so and there is nothing more to add here.
  await expect(page.getByText(cs.passkeys.thisDevice)).toBeVisible()
  await expect(page.getByRole('button', { name: cs.passkeys.addHere })).toHaveCount(0)

  // 3. Someone with a passkey is not offered another one.
  await logout(page)
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)

  // 4. A passkey login honours the redirect and marks the passkey as used.
  await logout(page)
  await page.goto('/login?redirect=/profil')
  await pressPasskeyButton(page)
  await expect(page).toHaveURL(/\/profil$/)
  await expect(page.getByText(/Naposledy /)).toBeVisible()

  // 4b. A second device (a Mac; the first is Desktop Chrome on Windows) adds itself in
  // Profil, then removes the other row; only the chosen one goes. The Mac's passkey stays
  // until the admin removes all of Táta's in step 7.
  const mac = await browser.newContext({
    baseURL,
    locale: 'cs-CZ',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0',
  })
  const pc = await mac.newPage()
  await addAuthenticator(pc)
  await passwordLogin(pc, 'tata')
  await expect(pc).toHaveURL(/\/$/)
  await pc.goto('/profil')
  await pc.getByRole('button', { name: cs.passkeys.addHere }).click()
  await expect(pc.getByText(cs.passkeys.added)).toBeVisible()
  const rows = pc
    .getByRole('listitem')
    .filter({ has: pc.getByRole('button', { name: cs.passkeys.remove, exact: true }) })
  await expect(rows).toHaveCount(2)
  const here = rows.filter({ hasText: cs.passkeys.thisDevice })
  await expect(here).toContainText(cs.passkeys.device.mac)
  await expect(pc.getByRole('button', { name: cs.passkeys.addHere })).toHaveCount(0)
  const windows = rows.filter({ hasText: cs.passkeys.device.windows })
  await windows.getByRole('button', { name: cs.passkeys.remove, exact: true }).click()
  await expect(pc.getByRole('dialog')).toContainText(cs.passkeys.device.windows)
  await pc.getByRole('dialog').getByRole('button', { name: cs.passkeys.remove }).click()
  await expect(pc.getByText(cs.passkeys.removed)).toBeVisible()
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText(cs.passkeys.thisDevice)
  await mac.close()

  // 5. A malformed answer is refused by the validator (an error, not a result) and shown.
  await logout(page)
  let refused: { status: number; body: string } | undefined
  await page.route(SERVER_FN, async (route) => {
    const body = route.request().postData() ?? ''
    if (!body.includes('public-key')) return route.fallback()
    const response = await route.fetch({ postData: body.replaceAll('public-key', 'x') })
    refused = { status: response.status(), body: await response.text() }
    return route.fulfill({ response })
  })
  await pressPasskeyButton(page)
  await expect.poll(() => refused).toBeDefined()
  // The validator throws: an error response, never a `{ ok: false }` login result.
  expect(refused?.body).toContain('Invalid passkey response')
  expect(refused?.body).not.toMatch(/not_verified|unknown_passkey/)
  await expect(page.getByRole('alert')).toHaveText(cs.login.failed)
  await expect(page).toHaveURL(/\/login/)
  await page.unroute(SERVER_FN)

  // 6. The offer can fail and still be skipped: failed text, buttons back, Teď ne → target.
  await passwordLogin(page, 'starsi', '/login?redirect=/tyden')
  await expect(page).toHaveURL(/\/klic/)
  await page.route(SERVER_FN, (route) => route.abort())
  await page.getByRole('button', { name: cs.passkeys.offerSet }).click()
  await expect(page.getByText(cs.login.failed)).toBeVisible()
  await expect(page.getByRole('button', { name: cs.passkeys.offerSet })).toBeEnabled()
  await expect(page.getByRole('button', { name: cs.passkeys.offerLater })).toBeEnabled()
  await page.unroute(SERVER_FN)
  await page.getByRole('button', { name: cs.passkeys.offerLater }).click()
  await expect(page).toHaveURL(/\/tyden$/)

  // 7. The admin sees who has passkeys and removes the right person's.
  await logout(page)
  await passwordLogin(page, 'admin')
  await page.getByRole('button', { name: cs.passkeys.offerLater }).click()
  await expect(page).toHaveURL(/\/sprava$/)
  const row = (name: string) => page.getByRole('listitem').filter({ hasText: name })
  await expect(row('Táta')).toContainText(formatKeys(1))
  await expect(row('Starší')).not.toContainText(formatKeys(1))
  await row('Táta').getByRole('button', { name: cs.passkeys.admin.removeAll }).click()
  const adminDialog = page.getByRole('dialog')
  await expect(adminDialog).toContainText(cs.passkeys.admin.confirmTitle('Táta'))
  await adminDialog.getByRole('button', { name: cs.passkeys.admin.removeAll }).click()
  await expect(page.getByText(cs.passkeys.admin.removed)).toBeVisible()
  await expect(row('Táta')).not.toContainText(formatKeys(1))

  // 8. The phone still offers the removed passkey: the server says it is unknown.
  await logout(page)
  await pressPasskeyButton(page)
  await expect(page.getByRole('alert')).toHaveText(cs.passkeys.unknown)
  // The passkey's own error: the untouched password form is not marked wrong.
  await expect(page.getByLabel(cs.login.password)).toHaveAttribute('aria-invalid', 'false')
  await expect(page).toHaveURL(/\/login/)

  // 9. Enrol again, then remove it in Profil; the dialog names the device and the date.
  await passwordLogin(page, 'tata')
  await enrolFromOffer(page)
  await page.goto('/profil')
  await page.getByRole('button', { name: cs.passkeys.remove, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(/Odebrat přihlášení: .+, přidáno \d{1,2}\. ?\d{1,2}\./)
  await expect(dialog).toContainText(cs.passkeys.removeConfirmText)
  await dialog.getByRole('button', { name: cs.passkeys.remove }).click()
  await expect(page.getByText(cs.passkeys.removed)).toBeVisible()
  await expect(page.getByText(cs.passkeys.empty)).toBeVisible()
  await logout(page)
  await pressPasskeyButton(page)
  await expect(page.getByRole('alert')).toHaveText(cs.passkeys.unknown)
})
