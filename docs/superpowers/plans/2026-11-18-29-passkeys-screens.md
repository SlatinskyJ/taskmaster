# Passkeys, screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the screens for #29 Passkey enrolment and login on top of the server half (PR #132): log in with a passkey, the offer after a password login, the list in Profil, the admin's removal on Správa, and a browser test that runs the real built server, with passkeys on and off.

**Architecture:** one browser-side module (`src/lib/passkeys.ts`) wraps `@simplewebauthn/browser` and the server functions from `~/server/passkeys/functions` (functions and their result types, nothing else from `~/server/passkeys`), plus a small login-flow controller that decides when autofill runs, so screens never touch WebAuthn directly and both are unit-tested with the library mocked. Screens: the login button, hint and autofill on `/login`, a new screen `/klic` (the offer, no bottom bar), a section on `/profil`, a row control on `/sprava`. Czech text only in `src/lib/strings.ts`. A Playwright test drives Chromium's virtual authenticator against `pnpm build` output in CI's build job: one server with passkeys on, one with them off.

**Tech Stack:** TanStack Start (React), `@simplewebauthn/browser` ^14.0.0 (pairs with server 14.1.0), `@playwright/test` 1.63.0 (dev), Tailwind v4 + shadcn (Dialog for confirms, sonner toasts).

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §11 Passkeys, §6; UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §7.4 (Login, Passkey, Profile), §7.5 (ASettings) and the Login / Passkey / Profile / ASettings mockups. Jakub's decisions 2026-11-18 (project thread): env-gated (off on previews), admin may remove a user's passkeys, password reset does not touch passkeys, offer screen "Nastavit" / "Teď ne" asked again at the next password login, usernameless button + autofill, UV required, profile lists passkeys with an automatic device name and removal with a confirm.

## Global Constraints

- UI labels in Czech, only in `src/lib/strings.ts`; code in English.
- **One name for the feature** in every user-facing string: "přihlášení otiskem / obličejem" (the button's wording, UI doc §7.4). No "klíč" anywhere in the UI except the admin's count on Správa, where the admin needs a countable noun ("1 klíč").
- Passkeys exist only when the server says so (`getPasskeysEnabledFn()` true). With them off (every preview) the screens look exactly as today: no button, no hint, no offer, no Profil section, no Správa control. Pinned by the "off" browser test (Task 6).
- Also hide every add/login control when the browser has no WebAuthn (`browserSupportsWebAuthn()` false).
- Components import from `~/server/**` only `~/server/<module>/functions` (ESLint screen rule). Types like the device kind come from `PasskeySummary` re-exported there, never from `~/server/db/schema`.
- Dates shown on screens are Prague dates via `formatPragueDate` (Task 4), never `toLocaleDateString` (the server renders in UTC).
- Every button that starts a server call is disabled while it runs; every failure shows `cs.login.failed` (toast or inline). No silent failures.
- Every new screen gates itself with `guardScreen(context.user.role, '<path>')`; `APP_PATHS`/`SCREEN_ROLES` updated.
- Reuse existing components (Button, Card, Dialog, SectionLabel, toasts); no new colours.
- No production host name anywhere in code, tests or docs (`localhost` in the browser test).
- Size goal: ~550 changed non-test lines.

## Review Focus

1. User cancels the Face ID sheet (`NotAllowedError`): no error text, the screen stays usable. Test: Task 1 unit + Task 2 controller unit.
2. A phone offers a passkey the server no longer has (removed in Profil or by the admin): the Czech "use your password" message, and the browser is told to forget it (`PublicKeyCredential.signalUnknownCredential` when present). Test: Task 1 unit; Task 6 e2e after the admin's removal.
3. The offer must not trap anyone: "Teď ne" always goes on to where login was heading; an error during "Nastavit" shows a message and still lets them go on. Test: Task 6 e2e (`starsi` with `?redirect=`).
4. One ceremony at a time: the button aborts a pending autofill; autofill is restarted only after the **button's** ceremony ends cancelled or failed, never from autofill's own outcome, and never after the options call answered `busy` (no request loop for a household sharing one IP). Test: Task 2 controller unit.
5. A malformed body to `passkeyLoginFn` is refused by the validator before verification (Tests judge's round-2 nit on PR #132). Test: Task 6 e2e asserts the server-function response is an error, not a `{ ok: false }` result.

---

### Task 1: Browser module `src/lib/passkeys.ts`

**Files:**
- Create: `src/lib/passkeys.ts`, `src/lib/passkeys.test.ts`
- Modify: `package.json`, `pnpm-lock.yaml` (`@simplewebauthn/browser` ^14.0.0)

**Interfaces:**
- Consumes: `passkeyLoginOptionsFn`, `passkeyLoginFn`, `passkeyRegisterOptionsFn`, `passkeyRegisterFn` and the result types, all from `~/server/passkeys/functions` (add type re-exports there if a type is missing; no other server import).
- Produces:
  - `type PasskeyLoginOutcome = { ok: true; user: CurrentUser } | { ok: false; reason: 'cancelled' | 'busy' | 'unknown' | 'rate_limited' | 'failed' }`
  - `loginWithPasskey(opts?: { autofill?: boolean }): Promise<PasskeyLoginOutcome>`
  - `type PasskeyAddOutcome = { ok: true } | { ok: false; reason: 'cancelled' | 'already' | 'failed' }`
  - `addPasskey(): Promise<PasskeyAddOutcome>`
  - `passkeysUsable(): boolean` (= `browserSupportsWebAuthn()`), `autofillUsable(): Promise<boolean>` (= `browserSupportsWebAuthnAutofill()`).

Mapping: options call answers `busy` → `busy`; server `disabled|expired_challenge|not_verified` → `failed`; `unknown_passkey` → `unknown` (and call `PublicKeyCredential.signalUnknownCredential?.({ rpId: options.rpId, credentialId: response.id })`, errors swallowed); `rate_limited` → `rate_limited`; `already_registered` → `already`. A thrown `NotAllowedError` / `AbortError` (or WebAuthnError `ERROR_CEREMONY_ABORTED`) → `cancelled`; any other throw (including a server-function error) → `failed`. `optionsJson` is `JSON.parse`d and passed as `optionsJSON`.

- [ ] **Step 1: Write the failing tests** (`vi.mock('@simplewebauthn/browser')`, `vi.mock('~/server/passkeys/functions')`):
  - `login: ok passes the parsed options and returns the user` — `startAuthentication` called with `{ optionsJSON: <parsed>, useBrowserAutofill: false }`, result `{ ok: true, user }`.
  - `login: autofill passes useBrowserAutofill: true`.
  - `login: NotAllowedError → cancelled`, `AbortError → cancelled`, `other throw → failed`, `server function throws → failed`.
  - `login: options busy → busy, and startAuthentication is not called`.
  - `login: unknown_passkey → unknown and signals the browser` — spy called with `{ rpId: 'tm.test', credentialId: 'cred-1' }`; with the API absent, still `unknown`, no throw.
  - `login: rate_limited → rate_limited; expired_challenge/not_verified/disabled → failed`.
  - `add: ok; already_registered → already; NotAllowedError → cancelled; busy → failed`.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/passkeys.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** per Interfaces; `pnpm add @simplewebauthn/browser@^14.0.0`.
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `Add the browser side of passkeys`.

### Task 2: Login screen: button, hint, autofill

**Files:**
- Modify: `src/routes/login.tsx`, `src/lib/strings.ts`, `src/lib/passkeys.ts`, `src/lib/passkeys.test.ts`
- Create: `src/components/auth/PasskeyLoginButton.tsx`, `src/components/auth/auth.test.tsx`

**Interfaces:**
- Consumes: Task 1, `getPasskeysEnabledFn` (route loader), `landingPath`, `safeRedirect`.
- Produces:
  - `createLoginFlow(deps: { login: typeof loginWithPasskey; onDone: (o: PasskeyLoginOutcome) => void }): { startAutofill(): void; clickButton(): Promise<void> }` in `src/lib/passkeys.ts`. Rules (Review Focus 4): `startAutofill` runs `login({ autofill: true })` at most once at a time; its own outcome is passed to `onDone` only when `ok` or `unknown`/`rate_limited` (a `cancelled`/`failed`/`busy` autofill is dropped silently and **not** restarted). `clickButton` runs `login()`, passes the outcome to `onDone`, then restarts autofill only if the outcome is `cancelled` or `failed` (not `busy`, not `ok`).
  - `PasskeyLoginButton({ busy, onClick })` (presentational).
  - Strings (`cs.passkeys`): `loginButton` = 'Přihlásit otiskem / obličejem', `hint` = 'První přihlášení nebo nový telefon? Použij heslo.' (Login mockup), `or` = 'nebo heslem', `unknown` = 'Přihlášení otiskem tu už neplatí. Přihlas se heslem.'.

Behaviour: the loader returns `{ passkeys: boolean }`. When `passkeys && passkeysUsable()`: the button above the form, the hint under it, then a divider with `cs.passkeys.or`; the username input gets `autoComplete="username webauthn"`; on mount, if `await autofillUsable()`, `flow.startAutofill()` (ref guard for StrictMode). Outcome in `onDone`: ok → `router.invalidate()` then navigate to `search.redirect ?? landingPath(user.role)` (same as password); `cancelled` → nothing; `unknown` → `cs.passkeys.unknown`; `rate_limited` → `cs.login.rateLimited`; `failed`/`busy` → `cs.login.failed`. Errors show in the existing `role="alert"` slot; the button is disabled while its ceremony runs.

- [ ] **Step 1: Failing tests:**
  - controller (`src/lib/passkeys.test.ts`, `login` a `vi.fn`): `autofill cancelled → not restarted, onDone not called`; `autofill busy → not restarted`; `button cancelled → autofill restarted once`; `button failed → autofill restarted once`; `button busy → no restart`; `button ok → onDone(ok), no restart`; `autofill ok → onDone(ok)`.
  - `PasskeyLoginButton shows the Czech label and is disabled when busy` (`renderToStaticMarkup`).
- [ ] **Step 2: Run** `pnpm vitest run src/lib/passkeys.test.ts src/components/auth` — FAIL.
- [ ] **Step 3: Implement** controller, button, loader, wiring in `login.tsx`; replace the two "#29 adds…" comments.
- [ ] **Step 4: Run** — PASS; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** `Log in with a passkey`.

### Task 3: The offer screen `/klic`

**Files:**
- Create: `src/routes/_app/klic.tsx`
- Modify: `src/lib/nav.ts` (`'/klic'` in `APP_PATHS`, `SCREEN_ROLES['/klic'] = ['taker','giver','admin']`, `BARLESS_PATHS = ['/klic']` + `showsBar(role, path)`), `src/lib/nav.test.ts`, `src/routes/_app.tsx` (bar + bottom padding only when `showsBar`), `src/routes/login.tsx`, `src/lib/strings.ts`, `src/routeTree.gen.ts` (generated)

**Interfaces:**
- Consumes: Task 1 `addPasskey`, `passkeysUsable`; `listMyPasskeysFn`, `getPasskeysEnabledFn`.
- Produces: route `/klic` with search `{ redirect?: string }` (validated by `safeRedirect`); `showsBar(role: Role, pathname: string): boolean`; strings `offerTitle` = 'Přihlásit otiskem / obličejem', `offerText` = 'Příště se přihlásíš jedním dotykem, bez hesla. Funguje s Face ID, otiskem prstu nebo zámkem telefonu.', `offerSet` = 'Nastavit', `offerLater` = 'Teď ne', `added` = 'Hotovo. Příště stačí otisk nebo obličej.', `already` = 'Tohle zařízení už přihlášení otiskem má.'

Behaviour: after a successful **password** login, `login.tsx` checks `passkeysEnabled && passkeysUsable()` and `(await listMyPasskeysFn()).length === 0`; if so it navigates to `/klic?redirect=<target>`, else to the target as today. A throw in that check goes straight to the target. On `/klic` (full screen, no bottom bar, as the Passkey mockup): "Nastavit" → both buttons disabled → `addPasskey()`; ok → toast `added`, go to target; `already` → toast `already`, go to target; `cancelled` → buttons enabled again, stay; `failed` → inline `cs.login.failed`, buttons enabled, "Teď ne" still there. "Teď ne" → target. Nothing is stored about "Teď ne", so the next password login asks again (Jakub's call). With passkeys off, `beforeLoad` redirects to the target.

- [ ] **Step 1: Failing tests**: `tests/screen-guards.test.ts` fails once the file exists without a gate; in `src/lib/nav.test.ts`: `everyone may see /klic`, `/klic is in nobody's bar`, `showsBar is false on /klic and true on / for a taker`, `false everywhere for the admin`.
- [ ] **Step 2: Run** `pnpm vitest run tests/screen-guards.test.ts src/lib/nav.test.ts` — FAIL.
- [ ] **Step 3: Implement** route, nav entries, layout, login hop; `pnpm dev` once to regenerate `routeTree.gen.ts`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Offer a passkey after a password login`.

### Task 4: Profil: my passkeys

**Files:**
- Create: `src/lib/formatDate.ts`, `src/lib/formatDate.test.ts`, `src/components/auth/PasskeyList.tsx`, `src/server/passkeys/deviceLabels.test.ts`
- Modify: `src/routes/_app/profil.tsx`, `src/lib/strings.ts`, `src/components/auth/auth.test.tsx`

**Interfaces:**
- Consumes: `listMyPasskeysFn`, `removeMyPasskeyFn`, `getPasskeysEnabledFn`, type `PasskeySummary` (from `~/server/passkeys/functions`), Task 1 `addPasskey`; `toPragueWallTime`, `parseIsoUtc` from `~/domain/dates`.
- Produces:
  - `formatPragueDate(iso: string): string` → `d. M. yyyy` of the Prague calendar day.
  - `cs.passkeys.device: Record<PasskeySummary['deviceKind'], string>` = `{ iphone: 'iPhone', ipad: 'iPad', android: 'Android', mac: 'Mac', windows: 'Windows', linux: 'Linux', other: 'Jiné zařízení' }` (exhaustive at compile time).
  - `PasskeyList({ items, busyId, onRemove })` presentational.
  - Strings: `section` = 'Přihlášení otiskem / obličejem', `addHere` = 'Přidat toto zařízení', `addedOn` = 'Přidáno {date}', `lastUsed` = 'Naposledy {date}', `neverUsed` = 'Zatím nepoužito', `remove` = 'Odebrat', `removeConfirmTitle` = 'Odebrat přihlášení: {device}?', `removeConfirmText` = 'Na zařízení {device} se pak přihlásíš heslem.', `removed` = 'Odebráno.', `empty` = 'Zatím žádné. Přidej toto zařízení.'

Behaviour: the Profil loader adds `passkeys: enabled ? await listMyPasskeysFn() : null`. The section shows when `enabled && passkeysUsable()` or the list is non-empty (so keys can be removed from a browser without WebAuthn); "Přidat toto zařízení" only when `passkeysUsable()`. Each row: device label, added date, last used. "Odebrat" opens a Dialog naming the row's device; confirm (disabled while running) → `removeMyPasskeyFn({ data: { passkeyId } })` → toast `removed` → `router.invalidate()`; a throw or `not_found` → `toast.error(cs.login.failed)` and invalidate. "Přidat toto zařízení" (disabled while running) → `addPasskey()` → toasts `added` / `already`; `failed` → `toast.error(cs.login.failed)`; `cancelled` → nothing. `backedUp` is not shown (no UI doc entry).

- [ ] **Step 1: Failing tests**:
  - `formatPragueDate('2026-11-17T23:30:00Z')` → `'18. 11. 2026'`; `'2026-11-17T22:59:59Z'` → `'17. 11. 2026'`; summer `'2026-06-30T22:30:00Z'` → `'1. 7. 2026'`.
  - `PasskeyList renders device label, Prague dates and a remove button per item`; `empty list shows cs.passkeys.empty`.
  - `src/server/passkeys/deviceLabels.test.ts`: every `DEVICE_KINDS` entry has a non-empty `cs.passkeys.device` label (runtime check lives under server, where the schema import is allowed).
- [ ] **Step 2: Run** `pnpm vitest run src/lib/formatDate.test.ts src/components/auth src/server/passkeys/deviceLabels.test.ts` — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `List and remove passkeys in Profil`.

### Task 5: Správa: the admin removes a user's passkeys

**Files:**
- Create: `src/components/auth/AdminPasskeys.tsx`
- Modify: `src/routes/_app/sprava.tsx`, `src/lib/strings.ts`, `src/components/auth/auth.test.tsx`

**Interfaces:**
- Consumes: `listPasskeyCountsFn`, `removeUserPasskeysFn`; `plural()` and `PluralForms` from `src/lib/strings.ts`.
- Produces: `keyWords: PluralForms = { one: 'klíč', few: 'klíče', many: 'klíčů' }` and `formatKeys(n)` (like `formatPoints`); `AdminPasskeys({ count, name, busy, onRemove })`; strings `admin.removeAll` = 'Odebrat klíče', `admin.confirmTitle` = 'Odebrat klíče: {name}?', `admin.confirmText` = 'Telefon tím neodhlásíš. Odhlásí ho až nové heslo.' (Security judge, PR #132), `admin.removed` = 'Klíče odebrány.'

Behaviour: the Správa loader also loads `listPasskeyCountsFn()` (works with passkeys off too, so the admin can clean up; with none stored nothing shows). A person with `count > 0` gets a second line under name + role: "N klíčů" and "Odebrat klíče" (wraps at 360 px, no overflow). Confirm Dialog (confirm disabled while running) → `removeUserPasskeysFn({ data: { userId } })` → toast `removed` → invalidate; a throw → `toast.error(cs.login.failed)`. One component, so #134 Admin screen: people (open, same file) only keeps one line on the row.

- [ ] **Step 1: Failing tests**: `formatKeys(1|2|4|5|21)` → `1 klíč`, `2 klíče`, `4 klíče`, `5 klíčů`, `21 klíčů`; `AdminPasskeys renders nothing for 0 and the label + button for 3`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Let the admin remove a user's passkeys`.

### Task 6: Browser test against the built server

**Files:**
- Create: `e2e/passkeys.spec.ts`, `e2e/passkeys-off.spec.ts`, `playwright.config.ts`
- Modify: `package.json` (`@playwright/test` 1.63.0 dev, script `"e2e": "playwright test"`), `.github/workflows/ci.yml` (build job, after the smoke step: `pnpm exec playwright install --with-deps chromium`, `pnpm e2e`, then `actions/upload-artifact` of `test-results/` with `if: failure()`, pinned by SHA like the other actions), `.gitignore` (`test-results/`, `playwright-report/`), ESLint/tsconfig includes for `e2e/` and `playwright.config.ts` if they sit outside them. `vitest.config.ts` unchanged (its include is `src/**`, `tests/**`).

**Interfaces:**
- Consumes: the whole stack; demo seed (`TASKMASTER_ENV=preview`: `admin`, `tata`, `starsi`, password `demo1234`).
- Produces: `playwright.config.ts` with two projects and two `webServer` entries, each `command: 'node .output/server/index.mjs'`, `reuseExistingServer: false`, `stdout: 'pipe'`, `DATA_DIR` a fresh `fs.mkdtempSync(os.tmpdir() + '/tm-e2e-')` per run, `TASKMASTER_ENV: 'preview'`, health URL `/api/health`:
  - project `on`: port 3100, `WEBAUTHN_RP_ID: 'localhost'`, `WEBAUTHN_ORIGIN: 'http://localhost:3100'`, runs `passkeys.spec.ts`;
  - project `off`: port 3101, no WEBAUTHN vars, runs `passkeys-off.spec.ts`.
  Chromium only; `launchOptions.executablePath` from `PW_CHROMIUM_PATH` when set (cloud sessions: `/opt/pw-browsers/chromium`). `workers: 1` (the `on` test is one ordered story on one DB).

`passkeys.spec.ts`, one ordered test `passkey story` (CDP `WebAuthn.enable` + `WebAuthn.addVirtualAuthenticator({ protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true })`):
1. `/login` shows the button and the hint. Password login as `tata` → `/klic` without bottom bar → "Nastavit" → tata's home.
2. Profil: one row, "Zatím nepoužito".
3. Log out; password login as `tata` again → straight to home, no `/klic` (has a passkey now).
4. Log out; `/login?redirect=/profil` → button → lands on `/profil`, row shows "Naposledy …" (passkey login honours `redirect`).
5. Validator (Review Focus 5): log out; `page.route` the next `passkeyLoginFn` POST and replace `"type":"public-key"` with `"type":"x"`; click the button; `page.waitForResponse` for that call has a non-2xx status or a serialized error (not a `{"ok":false,…}` result); `cs.login.failed` shown, still on `/login`. Remove the route.
6. Offer escape (Review Focus 3): password login as `starsi` via `/login?redirect=/tyden` → `/klic` → "Teď ne" → `/tyden`.
7. Admin (Review Focus 2 and the right user): log out; password login as `admin` (offer → "Teď ne") → Správa: tata's row shows "1 klíč", starsi's row none → "Odebrat klíče" → confirm → toast; tata's row has no count.
8. Log out; button → `cs.passkeys.unknown` shown, still on `/login`.

`passkeys-off.spec.ts`, test `passkeys off look as today`: `/login` has no passkey button and no hint, the username input's `autocomplete` is `username`; password login as `tata` goes straight home (no `/klic`); `/klic` typed directly lands on home; Profil has no passkey section; admin's Správa rows show no count or remove button.

- [ ] **Step 1: Write** config and both specs.
- [ ] **Step 2: Run** `pnpm build && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e` — Expected: 2 passed. Then break one thing on purpose per spec (drop the loader flag check on `/login`; send `userId` of the wrong row) and see each FAIL, revert.
- [ ] **Step 3: CI** step added; push; Expected: `build` job green, e2e step lists 2 passed.
- [ ] **Step 4: Commit** `Test passkeys end to end in a browser`.

### Task 7: Docs and cleanup

**Files:**
- Modify: `src/server/passkeys/README.md` (screens: where each lives; trying passkeys locally: `pnpm build`, then `WEBAUTHN_RP_ID=localhost WEBAUTHN_ORIGIN=http://localhost:3000 TASKMASTER_ENV=preview node .output/server/index.mjs`; `pnpm e2e`). `src/server/demo/`: **no change**: previews run with passkeys off, so there is no passkey sample data to seed (CLAUDE.md "each feature PR adds its sample data": nothing to add; said in the brief).

- [ ] **Step 1:** README section.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` — all green.
- [ ] **Step 3: Commit** `Document the passkey screens`.

After the build: `preview` label (screens change; previews show the "off" state), brief with screenshots of the "on" screens from the e2e run, then Jakub's one-off iPhone test on his PC (steps in the brief and the thread, host as a placeholder).
