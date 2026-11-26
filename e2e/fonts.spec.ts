import { expect, type Page, test } from '@playwright/test'
import { cs } from '../src/lib/strings'
import { passwordLogin } from './helpers'

// Czech letters must come from the app's own fonts, never a system fallback (#246). Fredoka has
// no ě č ř ů ť ď ň, so it draws digits only; every letter is Baloo 2 (headings, buttons) or
// Nunito (body). Read-only, on the `demo` seed. Fonts are read through the DevTools protocol:
// which font file actually drew each element's glyphs.

interface PlatformFont {
  familyName: string
  isCustomFont: boolean
  glyphCount: number
}

interface Scan {
  text: string
  isNum: boolean
  fonts: PlatformFont[]
}

const CZECH = /[ěščřžýáíéůúťďňĚŠČŘŽÝÁÍÉŮÚŤĎŇ]/
const LETTER = /\p{L}/u

/** Every visible element under `root` whose own text holds a letter or a digit, with its fonts. */
async function scanFonts(page: Page, root = 'body'): Promise<Scan[]> {
  const marked = await page.evaluate((rootSelector) => {
    const out: { text: string; isNum: boolean }[] = []
    const base = document.querySelector(rootSelector)
    if (!base) return out
    for (const el of [base, ...base.querySelectorAll('*')]) {
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim()
      if (!/[\p{L}0-9]/u.test(own) || !el.checkVisibility()) continue
      el.setAttribute('data-font-scan', String(out.length))
      out.push({ text: own, isNum: el.classList.contains('num') })
    }
    return out
  }, root)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root: doc } = await cdp.send('DOM.getDocument', { depth: -1 })
  const scans: Scan[] = []
  for (const [i, entry] of marked.entries()) {
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: doc.nodeId,
      selector: `[data-font-scan="${String(i)}"]`,
    })
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
    scans.push({ ...entry, fonts })
  }
  await cdp.detach()
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-font-scan]'))
      el.removeAttribute('data-font-scan')
  })
  return scans
}

/** Czech text drawn (partly) by a font the app did not ship. */
function systemFallbacks(scans: Scan[]): string[] {
  return scans
    .filter((s) => CZECH.test(s.text))
    .flatMap((s) =>
      s.fonts.filter((f) => !f.isCustomFont).map((f) => `${s.text.slice(0, 30)}: ${f.familyName}`),
    )
}

/** A `num` line with words: Fredoka must draw its digits and nothing else. */
function mixedWords(scans: Scan[]): string[] {
  return scans
    .filter((s) => s.isNum && LETTER.test(s.text))
    .flatMap((s) => {
      const fredoka = s.fonts
        .filter((f) => f.familyName.includes('Fredoka'))
        .reduce((sum, f) => sum + f.glyphCount, 0)
      const digits = (s.text.match(/[0-9]/g) ?? []).length
      return fredoka === digits
        ? []
        : [`${s.text}: ${String(fredoka)} Fredoka glyphs for ${String(digits)} digits`]
    })
}

const families = (scan: Scan | undefined) => scan?.fonts.map((f) => f.familyName) ?? []

async function login(page: Page) {
  await passwordLogin(page, 'tata')
  await expect(page).toHaveURL(/\/$/)
}

async function ready(page: Page, path: string, mustSee: string) {
  await page.goto(path)
  await expect(page.locator('body')).toContainText(mustSee)
  await page.evaluate(() => document.fonts.ready)
}

function expectClean(scans: Scan[], mustSee: string) {
  expect(scans.map((s) => s.text)).toContainEqual(expect.stringContaining(mustSee))
  expect(systemFallbacks(scans)).toEqual([])
  expect(mixedWords(scans)).toEqual([])
}

test('/login: Czech letters in app fonts', async ({ page }) => {
  await ready(page, '/login', cs.login.submit)
  expectClean(await scanFonts(page), cs.login.submit)
})

const SCREENS = [
  ['/', cs.work.toApprove],
  ['/ukoly', cs.tasks.groupProposed],
  ['/tyden', cs.proposals.title],
  ['/schuzka', cs.meeting.steps[0]],
  ['/profil', cs.profile.title],
] as const

for (const [path, mustSee] of SCREENS) {
  test(`${path}: Czech letters in app fonts`, async ({ page }) => {
    await login(page)
    await ready(page, path, mustSee)
    expectClean(await scanFonts(page), mustSee)
  })
}

test('Týden history: digits Fredoka, words Baloo 2', async ({ page }) => {
  await login(page)
  await ready(page, '/tyden', cs.week.history)
  await page.getByRole('tab', { name: cs.week.history }).click()
  await expect(page.locator('main')).toContainText(cs.week.deducted)
  await page.evaluate(() => document.fonts.ready)
  const scans = await scanFonts(page)
  expectClean(scans, cs.week.deducted)
  const line = scans.find((s) => s.isNum && s.text.includes(cs.week.deducted))
  expect(families(line)).toContainEqual(expect.stringMatching(/Fredoka/))
  expect(families(line)).toContainEqual(expect.stringMatching(/Baloo/))
})

test('headings Baloo 2, numbers Fredoka', async ({ page }) => {
  await login(page)
  await ready(page, '/ukoly', cs.tasks.groupProposed)
  const [heading] = await scanFonts(page, 'h1')
  expect(families(heading)).toEqual([expect.stringMatching(/Baloo/)])
  const number = (await scanFonts(page, 'main')).find((s) => s.isNum && /^[0-9]+$/.test(s.text))
  expect(families(number)).toEqual([expect.stringMatching(/Fredoka/)])
})

test('ScoreDial digits are Fredoka', async ({ page }) => {
  await login(page)
  await ready(page, '/ukoly/novy', cs.tasks.createTitle)
  await expect(page.getByRole('slider')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const dial = await scanFonts(page, '[role="slider"]')
  expect(dial.length).toBeGreaterThan(0)
  for (const scan of dial) expect(families(scan)).toEqual([expect.stringMatching(/Fredoka/)])
})
