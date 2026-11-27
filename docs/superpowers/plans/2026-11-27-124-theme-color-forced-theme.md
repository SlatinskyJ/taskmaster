# Theme-color and offline page follow the in-app theme: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#124 Theme-color and offline page follow the in-app theme](https://github.com/SlatinskyJ/taskmaster/issues/124), Jakub's decision 2026-11-27: follow the app's chosen theme.

**Goal:** When the user forces Světlý or Tmavý in Profil, the browser's `theme-color` and the offline page use that theme; with `auto` (Podle telefonu) both keep following the phone.

**Architecture:** One rule in `src/lib/theme.ts`: `themeColorFor(pref, media)` gives a theme-color meta's colour. `applyThemePref` (on change) and `themeBootScript` (before first paint) both write it into every `meta[name="theme-color"]`, keeping the two `prefers-color-scheme` metas: a forced theme sets both to its `--bg`, `auto` gives each its own scheme's colour back. The offline page embeds the same `themeBootScript` after its own two metas, and its CSS gets the same `data-theme` selectors as `theme.css`. So one script string serves the app and the offline page, and its unit tests cover both.

**Tech Stack:** TypeScript, React 19 (TanStack Start root route), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §11 (PWA [call]); UI doc §1, §2.1 (`bg` tokens), §7.4 (Profil theme switch). Decision: the issue comment of 2026-11-27.

**Size:** about 35 changed lines outside tests (`theme.ts` about 20, `head.ts` 3, `__root.tsx` 5, `offline.ts` 10). Tests: about 45 lines in `theme.test.ts`, 25 in `offline.test.ts`, 2 in `manifest.test.ts`, about 40 in a new `e2e/theme.spec.ts` plus its `e2e/suites.ts` row.

## Global Constraints

- Colours are the page `bg` tokens (UI doc §2.1): light `#FFF5EE`, dark `#1D1524`. `THEME_COLORS` stays the one copy in TS; `manifest.test.ts` keeps it equal to `theme.css`, `offline.test.ts` keeps `OFFLINE_TOKENS` equal to `theme.css`.
- `themeBootScript` stays tiny and dependency-free (it is serialised into HTML) and must never throw (storage may be blocked).
- `auto` keeps today's two metas with `media="(prefers-color-scheme: light|dark)"` and their own colours.
- `sw.js` stays a classic script with no imports; the offline page stays one self-contained string (`offlineHtml`), no network.
- Czech text only from `src/lib/strings.ts`; no new strings.
- Shared module (`src/lib/theme.ts`): not a trivial PR.

## Review Focus

- Order in `<head>`: the boot script must run after the theme-color metas exist, or it finds none on first paint. Today `__root.tsx` renders the script first; Task 2 moves the metas above it, and the e2e (Task 3) loads a page with a stored choice and reads the metas.
- Hydration: the boot script changes `content` before React hydrates, so the metas get `suppressHydrationWarning` (like `<html>` has for `data-theme`). The e2e fails on any console message about hydration.
- Back to `auto` without a reload: each meta must get its own scheme's colour back, not stay forced. Pinned in Task 1 (`applyThemePref('auto')` after `'dark'`) and Task 3.
- Blocked storage (private mode): the boot script throws inside its `try` before it touches the metas, so they keep the server's `auto` values; `applyThemePref` still sets the metas. Pinned in Task 1.
- Offline page with no stored choice or an unknown value (`'purple'`): follows the phone, as today. Pinned in Task 1 (boot script cases) and Task 2 (page CSS keeps the media block).

---

### Task 1: one theme-color rule in `theme.ts`

**Files:**
- Modify: `src/lib/theme.ts` (`THEME_COLORS` moves here, `themeColorFor`, `applyThemePref`, `themeBootScript`)
- Modify: `src/pwa/head.ts` (imports `THEME_COLORS` from `~/lib/theme` and re-exports it, so `manifest.test.ts` imports stay)
- Test: `src/lib/theme.test.ts`

**Interfaces:**
- Produces:
  - `export const THEME_COLORS = { light: '#FFF5EE', dark: '#1D1524' } as const` in `theme.ts` (moved from `head.ts`, same doc comment).
  - `export function themeColorFor(pref: ThemePref, media: string): string`: a forced pref gives `THEME_COLORS[pref]`; `auto` gives `THEME_COLORS.dark` when `media` contains `dark`, else `THEME_COLORS.light`.
  - `applyThemePref(pref)` also sets `content = themeColorFor(pref, meta.media)` on every `document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')`, before it touches storage (so blocked storage cannot skip it).
  - `themeBootScript` does the same for the stored choice, in plain ES5 with the two colours interpolated from `THEME_COLORS` (no second copy of the hex values in source).

- [ ] **Step 1: Write the failing tests.** Extend the `document` stub with `querySelectorAll: (selector) => selector === 'meta[name="theme-color"]' ? metas : []`, where `beforeEach` sets `metas = [{ media: '(prefers-color-scheme: light)', content: THEME_COLORS.light }, { media: '(prefers-color-scheme: dark)', content: THEME_COLORS.dark }]`, and a helper `colors = () => metas.map((m) => m.content)`.

```ts
describe('themeColorFor', () => {
  it.each([
    ['light', '(prefers-color-scheme: light)', '#FFF5EE'],
    ['light', '(prefers-color-scheme: dark)', '#FFF5EE'],
    ['dark', '(prefers-color-scheme: light)', '#1D1524'],
    ['dark', '(prefers-color-scheme: dark)', '#1D1524'],
    ['auto', '(prefers-color-scheme: light)', '#FFF5EE'],
    ['auto', '(prefers-color-scheme: dark)', '#1D1524'],
  ] as const)('%s on the %s meta is %s', (pref, media, color) => {
    expect(themeColorFor(pref, media)).toBe(color)
  })
})
```

In `describe('applyThemePref')`:
- `'forces dark: both theme-color metas take the dark page colour'`: `applyThemePref('dark')` → `colors()` is `['#1D1524', '#1D1524']`.
- `'forces light the same way'` gets `expect(colors()).toEqual(['#FFF5EE', '#FFF5EE'])` after the phone-dark meta was forced dark first.
- `'back to auto, each meta follows its own colour scheme again'`: `'dark'` then `'auto'` → `['#FFF5EE', '#1D1524']`.
- `'still applies the theme when storage is blocked'` also expects `colors()` `['#1D1524', '#1D1524']`.

In `describe('themeBootScript')`:
- the `applies a stored %s before paint` case also expects both metas at `THEME_COLORS[stored]`.
- the `leaves the system in charge for %s` case also expects `['#FFF5EE', '#1D1524']` (starting both metas at a wrong colour, e.g. `'#000000'`, so the test proves the script wrote them).
- `'agrees with themeColorFor for every stored choice'`: for each of `undefined, 'light', 'dark', 'auto', 'purple'`, reset metas, run the script, expect each meta's content to equal `themeColorFor(parseThemePref(stored), meta.media)`.
- the blocked-storage case also expects the metas unchanged.

- [ ] **Step 2: Run and see them fail.** `pnpm exec vitest run src/lib/theme.test.ts`. Expected: FAIL (`themeColorFor` is not exported; meta colours unchanged).

- [ ] **Step 3: Implement** as in Interfaces. The boot script, for reference (the only part whose shape the tests leave open):

```ts
export const themeBootScript = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}'),f=t==='light'||t==='dark',c={light:'${THEME_COLORS.light}',dark:'${THEME_COLORS.dark}'};if(f)document.documentElement.dataset.theme=t;document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.content=c[f?t:m.media.indexOf('dark')>=0?'dark':'light']})}catch(e){}`
```

Update the comment above it: it now also sets the theme-color metas, so it must run after them in `<head>`.

- [ ] **Step 4: Run and see them pass.** `pnpm exec vitest run src/lib/ src/pwa/`. Expected: all PASS (`manifest.test.ts` unchanged, through the re-export).

- [ ] **Step 5: Commit** `theme.ts`, `theme.test.ts`, `head.ts`: "Theme-color follows a forced in-app theme".

### Task 2: the app's head and the offline page run it

**Files:**
- Modify: `src/routes/__root.tsx` (metas above the boot script, `suppressHydrationWarning` on them)
- Modify: `src/pwa/offline.ts` (two theme-color metas, `data-theme` CSS, the boot script; header comment no longer says "no scripts")
- Test: `src/pwa/offline.test.ts`

**Interfaces:**
- Consumes: `themeBootScript` and `THEME_COLORS` from Task 1 (`offline.ts` imports `~/lib/theme`; it runs only at build time in `vite-plugin.ts`, so the React import there does not reach `sw.js`).

- [ ] **Step 1: Write the failing tests** in `offline.test.ts`:
  - `'carries the in-app theme script after both theme-color metas'`: the page contains `<script>${themeBootScript}</script>`; both `<meta name="theme-color" content="#FFF5EE" media="(prefers-color-scheme: light)">` and the dark one are present, and each `indexOf` is below the script's.
  - `'applies a forced theme by data-theme, and keeps following the phone otherwise'`: the CSS has `@media (prefers-color-scheme: dark){:root:not([data-theme=light]){<dark vars>}}` and `:root[data-theme=dark]{<dark vars>}` (built with the same `cssVars(OFFLINE_TOKENS.dark)` text the test reconstructs from the tokens).
  - `'uses the same page colours as the theme-color'`: `OFFLINE_TOKENS.light.bg === THEME_COLORS.light.toLowerCase()`, same for dark.
  - The existing token check against `theme.css` stays as it is.

- [ ] **Step 2: Run and see them fail.** `pnpm exec vitest run src/pwa/offline.test.ts`. Expected: the three new cases FAIL.

- [ ] **Step 3: Implement.** In `offlinePage`: after the viewport meta, the two metas from `themeColorMeta`'s values (import `THEME_COLORS`; write them out in the page, no import of `head.ts`, which pulls the strings module in for nothing), then `<script>${themeBootScript}</script>`, then the style with the two selectors above in place of today's `@media … {:root{…}}`. In `__root.tsx`: render `themeColorMeta.map(…)` with `suppressHydrationWarning` before the boot script, and update the comment there ("the boot script sets data-theme and the theme-color metas before hydration").

- [ ] **Step 4: Run.** `pnpm exec vitest run src/pwa/ src/lib/`. Expected: all PASS.

- [ ] **Step 5: Commit** `offline.ts`, `offline.test.ts`, `__root.tsx`: "Offline page follows the in-app theme".

### Task 3: e2e in a real browser

**Files:**
- Create: `e2e/theme.spec.ts`
- Modify: `e2e/suites.ts` (row `{ name: 'theme', spec: 'theme.spec.ts', seed: 'family' }` with a comment "Profil → Vzhled: theme-color follows the chosen theme (#124). Read-only: the choice lives in the browser.")

**Interfaces:**
- Consumes: `passwordLogin` from `e2e/helpers.ts`; `cs.profile.themeLight`, `themeDark`, `themeAuto`.

- [ ] **Step 1: Write the test** `'theme-color follows Světlý, Tmavý and Podle telefonu, also after a reload (#124)'`, with `colorScheme: 'light'` (Playwright's default), collecting `page.on('console')` messages:
  1. Log in as `tata`, go to `/profil`, tap `cs.profile.themeDark`.
  2. `metaColors(page)` = `page.locator('meta[name="theme-color"]').evaluateAll((ms) => ms.map((m) => m.getAttribute('content')))` → `['#1D1524', '#1D1524']`.
  3. `page.reload()` → the same (the boot script, before React), and `html[data-theme=dark]`.
  4. Tap `themeLight` → `['#FFF5EE', '#FFF5EE']`; tap `themeAuto` → `['#FFF5EE', '#1D1524']`.
  5. No console message matches `/hydrat/i`.

- [ ] **Step 2: Prove it catches the head order**: with `__root.tsx` rendering the boot script above the metas again (local revert of that hunk only), step 3 must FAIL. Restore.

- [ ] **Step 3: Run.** `pnpm build && pnpm exec playwright test --project theme --repeat-each 3`. Expected: all PASS.

- [ ] **Step 4: Full check and commit.** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` (includes `tests/e2e-suites.test.ts` for the new row), then `pnpm e2e` once. Commit `e2e/theme.spec.ts`, `e2e/suites.ts`: "Test that theme-color follows the chosen theme".

Not tested end to end: the offline page in a browser (it needs the worker and a failed navigation). Its script is the boot script, covered in Task 1, and its placement and CSS are covered in Task 2. Screenshots for the brief: Profil with Tmavý on a light phone (shows the page, not the status bar; the colour change itself is stated in the brief with the meta values).
