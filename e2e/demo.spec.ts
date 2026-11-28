import { expect, test, type Page } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { TASK_TITLE_MAX } from '../src/lib/taskLimits'
import { forceClick, logout, PASSWORD, passwordLogin } from './helpers'

// The public demo (TASKMASTER_ENV=demo, #327) through the real entry points: links are removed
// from what a visitor sends, the locked actions change nothing, and the dev pages work. Its own
// server on the `demo` seed (every switch on). The screens (#328): the marker and noindex, the
// one-tap logins, the locked controls shown disabled and the lock refusal in Czech.

test.use({ viewport: { width: 360, height: 800 } })
test.describe.configure({ mode: 'serial' })

/** Not in the demo seed, so its row is the only one. */
const TITLE = 'Zalít kytky na balkóně'

async function login(page: Page, who: string) {
  await passwordLogin(page, who)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}

async function newTask(page: Page, title: string, description?: string) {
  await page.goto('/ukoly/novy')
  await page.getByLabel(cs.tasks.title).fill(title)
  if (description !== undefined) await page.getByLabel(cs.description.newField).fill(description)
  await page.getByRole('button', { name: cs.tasks.propose, exact: true }).click()
}

test('links are removed from a new task: the title and text keep the rest', async ({ page }) => {
  await login(page, 'tata')
  await newTask(page, `${TITLE} www.evil.cz`, 'viz https://evil.cz')
  await expect(page.getByText(cs.tasks.created, { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/ukoly$/)
  const row = page.getByRole('listitem').filter({ has: page.getByText(TITLE, { exact: true }) })
  await expect(row).toBeVisible()
  await row.getByRole('link').first().click()
  await expect(page.getByRole('heading', { name: TITLE, exact: true })).toBeVisible()
  await expect(page.locator('[data-slot="description"]')).toContainText('viz')
  await expect(page.locator('body')).not.toContainText('evil.cz')
})

test('a title that is only a link is refused as an empty title', async ({ page }) => {
  await login(page, 'tata')
  await newTask(page, 'https://evil.cz')
  await expect(page.getByText(cs.tasks.errors.invalidTitle(TASK_TITLE_MAX))).toBeVisible()
  await expect(page).toHaveURL(/\/ukoly\/novy$/)
})

test('the admin cannot flip a launch switch', async ({ page }) => {
  const t = cs.admin.features
  await login(page, 'admin')
  await expect(page).toHaveURL(/\/sprava$/)
  const card = page.getByRole('region', { name: t.title })
  const zapsat = card.getByRole('switch', { name: t.names.log.name, exact: true })
  await expect(zapsat).toHaveAttribute('aria-checked', 'true')
  await expect(zapsat).toBeDisabled()
  await expect(card.getByText(cs.demo.lockedNote)).toBeVisible()
  // Forced past the disabled control: the server still refuses.
  await forceClick(zapsat)
  await page.getByRole('dialog').getByRole('button', { name: t.confirmOff, exact: true }).click()
  await expect(page.getByText(cs.demo.lockedError, { exact: true })).toBeVisible()
  await page.reload()
  await expect(zapsat).toHaveAttribute('aria-checked', 'true')
})

test('Anička cannot change her password; the old one still logs in', async ({ page }) => {
  await login(page, 'starsi')
  await page.goto('/profil')
  const row = page.getByRole('button', { name: cs.profile.passwordRow })
  await expect(row).toBeDisabled()
  await expect(page.getByText(cs.demo.lockedNote)).toBeVisible()
  // Forced past the disabled row: the server still refuses.
  await forceClick(row)
  const sheet = page.getByRole('dialog', { name: cs.profile.passwordTitle })
  await sheet.getByLabel(cs.profile.currentPassword, { exact: true }).fill(PASSWORD)
  await sheet.getByLabel(cs.profile.newPassword, { exact: true }).fill('noveheslo1')
  await sheet.getByLabel(cs.profile.newPasswordAgain, { exact: true }).fill('noveheslo1')
  await sheet.getByRole('button', { name: cs.profile.passwordSubmit }).click()
  await expect(sheet.getByRole('alert')).toHaveText(cs.demo.lockedError)
  await expect(page.getByText(cs.profile.passwordChangedOthers)).toHaveCount(0)
  await logout(page)
  await login(page, 'starsi')
  await expect(page).not.toHaveURL(/\/login/)
})

/** Táta's row on Správa opens his sheet. */
async function openTata(page: Page) {
  await page.getByRole('button', { name: cs.admin.editPerson('Táta') }).click()
  return page.getByRole('dialog', { name: 'Táta' })
}

test('the admin sees people locked', async ({ page }) => {
  await login(page, 'admin')
  await expect(page.getByRole('button', { name: cs.admin.add, exact: true })).toBeDisabled()
  const sheet = await openTata(page)
  await expect(sheet.getByRole('textbox', { name: cs.admin.displayName })).toBeDisabled()
  await expect(sheet.getByRole('button', { name: cs.admin.save, exact: true })).toBeDisabled()
  await expect(sheet.getByRole('button', { name: cs.admin.reset, exact: true })).toBeDisabled()
  await expect(sheet.getByText(cs.demo.lockedNote)).toBeVisible()
})

test('a forced save on the locked sheet shows the Czech lock error', async ({ page }) => {
  await login(page, 'admin')
  const sheet = await openTata(page)
  // A visitor re-enabling the form in DevTools: the server still refuses.
  await sheet.locator('fieldset').evaluate((el) => {
    el.removeAttribute('disabled')
  })
  const name = sheet.getByRole('textbox', { name: cs.admin.displayName })
  await name.fill('Taťka')
  await sheet.getByRole('button', { name: cs.admin.save, exact: true }).click()
  await expect(sheet.getByRole('alert')).toHaveText(cs.demo.lockedError)
  await page.reload()
  await expect(page.getByRole('button', { name: cs.admin.editPerson('Táta') })).toBeVisible()
  await expect(page.getByRole('button', { name: cs.admin.editPerson('Taťka') })).toHaveCount(0)
})

test('a forced password reset on the locked sheet shows the Czech lock error', async ({ page }) => {
  await login(page, 'admin')
  const sheet = await openTata(page)
  // The reset button is disabled by the fieldset only, so removing its attribute re-enables it.
  await sheet.locator('fieldset').evaluate((el) => {
    el.removeAttribute('disabled')
  })
  await sheet.getByRole('button', { name: cs.admin.reset, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: cs.admin.resetTitle })
  await dialog.getByRole('textbox', { name: cs.admin.password }).fill('noveheslo1')
  await dialog.getByRole('button', { name: cs.admin.resetSubmit, exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText(cs.demo.lockedError)
  await logout(page)
  await login(page, 'tata')
  await expect(page).not.toHaveURL(/\/login/)
})

/** The demo marker and the robots meta, as every demo screen has them (#328). */
async function expectDemoChrome(page: Page) {
  await expect(page.locator('[data-slot="demo-marker"]')).toHaveText(cs.demo.marker)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
}

test('every screen shows the demo marker and noindex', async ({ page }) => {
  await page.goto('/login')
  await expectDemoChrome(page)
  expect(await (await page.request.get('/login')).text()).toContain('name="robots"')

  await login(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
  await expectDemoChrome(page)
  await logout(page)

  await login(page, 'admin')
  await expect(page).toHaveURL(/\/sprava$/)
  await expectDemoChrome(page)

  await page.setViewportSize({ width: 1440, height: 1200 })
  await page.goto('/dev/multi')
  await expect(page.locator('[data-device]')).toHaveCount(3)
  await expectDemoChrome(page)
})

const demoButton = (page: Page, name: string) =>
  page.getByRole('region', { name: cs.demo.tryAs }).getByRole('button', { name, exact: true })

test('each demo button logs in with one tap', async ({ page }) => {
  for (const login of ['admin', 'tata', 'starsi', 'mladsi'] as const) {
    const name = cs.demo.users[login]
    await page.goto('/login')
    await demoButton(page, name).click()
    if (login === 'admin') {
      await expect(page).toHaveURL(/\/sprava$/)
      await expect(page.getByRole('heading', { name: cs.admin.title, exact: true })).toBeVisible()
    } else {
      await expect(page).toHaveURL(/\/$/)
      await expect(
        page.getByRole('heading', { name: `${cs.home.greeting}, ${name}!` }),
      ).toBeVisible()
    }
    await logout(page)
  }
})

test('Více zařízení opens the viewer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await page.goto('/login')
  await page.getByRole('link', { name: cs.demo.multi, exact: true }).click()
  await expect(page).toHaveURL(/\/dev\/multi$/)
  await expect(page.locator('[data-device]')).toHaveCount(3)
})

test('the form still works under the buttons', async ({ page }) => {
  await passwordLogin(page, 'starsi')
  await expect(page).toHaveURL(/\/$/)
})

test('a failed one-tap login can be tried again', async ({ page }) => {
  let failed = false
  await page.route('**/_serverFn/**', async (route) => {
    const body = route.request().postData() ?? ''
    if (!failed && route.request().method() === 'POST' && body.includes('tata')) {
      failed = true
      await route.fulfill({ status: 500, body: 'boom' })
      return
    }
    await route.continue()
  })
  await page.goto('/login')
  await demoButton(page, cs.demo.users.tata).click()
  await expect(page.locator('#login-error')).toHaveText(cs.login.failed)
  for (const login of ['admin', 'tata', 'starsi', 'mladsi'] as const)
    await expect(demoButton(page, cs.demo.users[login])).toBeEnabled()
  await expect(page.getByRole('button', { name: cs.login.submit, exact: true })).toBeEnabled()
  await demoButton(page, cs.demo.users.tata).click()
  await expect(page).toHaveURL(/\/$/)
  expect(failed).toBe(true)
})

test('/dev/multi loads and a frame logs in as Béďa', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await page.goto('/dev/multi')
  await expect(page.locator('[data-device]')).toHaveCount(3)
  const mladsi = page.locator('[data-device]').nth(2).frameLocator('iframe')
  await expect(mladsi.getByRole('heading', { name: `${cs.home.greeting}, Béďa!` })).toBeVisible()
})
