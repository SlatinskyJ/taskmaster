# Passkeys, screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the screens for #29 Passkey enrolment and login on top of the server half (PR #132): log in with a passkey, the offer after a password login, the list in Profil, the admin's removal on Správa, and a browser test that runs the real built server.

**Architecture:** one browser-side module (`src/lib/passkeys.ts`) wraps `@simplewebauthn/browser` and the server functions from `~/server/passkeys/functions`, so screens never touch WebAuthn directly and the module is unit-tested with the library mocked. Screens: the login button and autofill on `/login`, a new screen `/klic` (the offer), a section on `/profil`, a row control on `/sprava`. Czech text only in `src/lib/strings.ts`. A Playwright test drives Chromium's virtual authenticator against `pnpm build` output, in CI's build job.

**Tech Stack:** TanStack Start (React), `@simplewebauthn/browser` ^14.0.0 (pairs with server 14.1.0), `@playwright/test` 1.63.0 (dev), Tailwind v4 + shadcn (Dialog for confirms).

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §11 Passkeys, §6; UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §7.4 (Login, Passkey, Profile), §7.5 (ASettings). Jakub's decisions 2026-11-18 (project thread): env-gated (off on previews), admin may remove a user's passkeys, password reset does not touch passkeys, offer screen "Nastavit" / "Teď ne" asked again at the next password login, usernameless button + autofill, UV required, profile lists passkeys with an automatic device name and removal with a confirm.

## Global Constraints

- UI labels in Czech, only in `src/lib/strings.ts`; code in English.
- Passkeys exist only when the server says so (`getPasskeysEnabledFn()` true). With them off (every preview) the screens look exactly as today: no button, no offer, no Profil section, no Správa control.
- Also hide every passkey control when the browser has no WebAuthn (`browserSupportsWebAuthn()` false).
- The browser never sees a credential id, key, counter or handle from the server (server already enforces; screens must not need them).
- Every new screen gates itself with `guardScreen(context.user.role, '<path>')`; `APP_PATHS`/`SCREEN_ROLES` updated.
- Effects 1.7× slower rule and Hřiště tokens: reuse existing components (Button, Card, Dialog, SectionLabel); no new colours.
- No production host name anywhere in code, tests or docs (use `taskmaster.example.cz`, or `localhost` in the browser test).
- Size goal: ~500 changed non-test lines.

## Review Focus

1. User cancels the Face ID sheet (`NotAllowedError`): no error text, the screen stays usable, autofill restarts.
2. A phone offers a passkey the server no longer has (removed in Profil or by the admin): Czech message "use your password", and the browser is told to forget it (`PublicKeyCredential.signalUnknownCredential` when present).
3. The offer must not trap anyone: "Teď ne" always goes on to where login was heading; an error during "Nastavit" shows a message and still lets them go on.
4. Two ceremonies at once (autofill pending, then the button): the button's call aborts the autofill one (the library does this); the single challenge cookie then belongs to the button's ceremony.
5. A malformed body to `passkeyLoginFn` is refused by the validator (the Tests judge's round-2 nit on PR #132): pinned in the browser test by corrupting the request.

Each has its test in the owning task.

---

### Task 1: Browser module `src/lib/passkeys.ts`

**Files:**
- Create: `src/lib/passkeys.ts`, `src/lib/passkeys.test.ts`
- Modify: `package.json`, `pnpm-lock.yaml` (`@simplewebauthn/browser` ^14.0.0)

**Interfaces:**
- Consumes: `passkeyLoginOptionsFn`, `passkeyLoginFn`, `passkeyRegisterOptionsFn`, `passkeyRegisterFn` (`~/server/passkeys/functions`), result types from `~/server/passkeys/handlers`.
- Produces:
  - `type PasskeyLoginOutcome = { ok: true; user: CurrentUser } | { ok: false; reason: 'cancelled' | 'unknown' | 'rate_limited' | 'failed' }`
  - `loginWithPasskey(opts?: { autofill?: boolean }): Promise<PasskeyLoginOutcome>`
  - `type PasskeyAddOutcome = { ok: true } | { ok: false; reason: 'cancelled' | 'already' | 'failed' }`
  - `addPasskey(): Promise<PasskeyAddOutcome>`
  - `passkeysUsable(): boolean` (= `browserSupportsWebAuthn()`), `autofillUsable(): Promise<boolean>` (= `browserSupportsWebAuthnAutofill()`).

Mapping: server `disabled|busy|expired_challenge|not_verified` → `failed`; `unknown_passkey` → `unknown` (and call `PublicKeyCredential.signalUnknownCredential?.({ rpId: options.rpId, credentialId: response.id })`, errors swallowed); `rate_limited` → `rate_limited`; `already_registered` → `already`. A thrown `NotAllowedError`/`AbortError` (WebAuthnError code `ERROR_CEREMONY_ABORTED` or name `NotAllowedError`) → `cancelled`; any other throw → `failed`. `optionsJson` is `JSON.parse`d and passed as `optionsJSON`.

- [ ] **Step 1: Write the failing tests** (`vi.mock('@simplewebauthn/browser')` and `vi.mock('~/server/passkeys/functions')`):
  - `login: ok passes the parsed options and returns the user` — expects `startAuthentication` called with `{ optionsJSON: <parsed>, useBrowserAutofill: false }`, result `{ ok: true, user }`.
  - `login: autofill passes useBrowserAutofill: true`.
  - `login: NotAllowedError → cancelled`, `AbortError → cancelled`, `other throw → failed`.
  - `login: unknown_passkey → unknown and signals the browser` — `signalUnknownCredential` spy called with `{ rpId: 'tm.test', credentialId: 'cred-1' }`; and when the API is absent, still `unknown`, no throw.
  - `login: rate_limited → rate_limited; busy/expired_challenge/not_verified/disabled → failed`.
  - `add: ok; already_registered → already; NotAllowedError → cancelled; busy → failed`.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/passkeys.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/lib/passkeys.ts` per Interfaces; add the dependency (`pnpm add @simplewebauthn/browser@^14.0.0`).
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `Add the browser side of passkeys`.

### Task 2: Login screen: button and autofill

**Files:**
- Modify: `src/routes/login.tsx`, `src/lib/strings.ts`
- Create: `src/components/auth/PasskeyLoginButton.tsx`, `src/components/auth/auth.test.tsx`

**Interfaces:**
- Consumes: Task 1, `getPasskeysEnabledFn` (route loader), `landingPath`, `safeRedirect`.
- Produces: `PasskeyLoginButton({ busy, onClick })` (presentational), strings `cs.passkeys.loginButton` = 'Přihlásit otiskem / obličejem', `cs.passkeys.or` = 'nebo heslem', `cs.passkeys.unknown` = 'Tenhle klíč už tu neplatí. Přihlas se heslem.', `cs.passkeys.failed` (reuse `cs.login.failed` text if equal — then reference it, no duplicate).

Behaviour: the loader returns `{ passkeys: boolean }`. When `passkeys && passkeysUsable()`: the button above the form, then a divider with `cs.passkeys.or`; the username input gets `autoComplete="username webauthn"`; on mount, if `await autofillUsable()`, start `loginWithPasskey({ autofill: true })` once (ref guard for StrictMode). A button click calls `loginWithPasskey()`. Outcome: ok → `router.invalidate()` then navigate to `search.redirect ?? landingPath(user.role)` (same as password); `cancelled` → nothing shown, restart autofill; `unknown` → `cs.passkeys.unknown`; `rate_limited` → `cs.login.rateLimited`; `failed` → `cs.login.failed`, restart autofill. Errors show in the existing `role="alert"` slot. Password success path: Task 3 adds the offer hop.

- [ ] **Step 1: Failing tests** (`renderToStaticMarkup`): `PasskeyLoginButton shows the Czech label and is disabled when busy`; and a test that the login strings exist and are non-empty.
- [ ] **Step 2: Run** `pnpm vitest run src/components/auth` — FAIL.
- [ ] **Step 3: Implement** button, loader, wiring in `login.tsx`; replace the two "#29 adds…" comments.
- [ ] **Step 4: Run** — PASS; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** `Log in with a passkey`.

### Task 3: The offer screen `/klic`

**Files:**
- Create: `src/routes/_app/klic.tsx`
- Modify: `src/lib/nav.ts` (`'/klic'` in `APP_PATHS`, `SCREEN_ROLES['/klic'] = ['taker','giver','admin']`), `src/lib/nav.test.ts` if it enumerates paths, `src/routes/login.tsx`, `src/lib/strings.ts`, `src/routeTree.gen.ts` (generated)

**Interfaces:**
- Consumes: Task 1 `addPasskey`, `passkeysUsable`; `listMyPasskeysFn`, `getPasskeysEnabledFn`.
- Produces: route `/klic` with search `{ redirect?: string }` (validated by `safeRedirect`); strings `cs.passkeys.offerTitle` = 'Přihlásit otiskem / obličejem', `offerText` = 'Příště se přihlásíš jedním dotykem, bez hesla. Funguje s Face ID, otiskem prstu nebo zámkem telefonu.', `offerSet` = 'Nastavit', `offerLater` = 'Teď ne', `added` = 'Hotovo. Příště stačí otisk nebo obličej.', `already` = 'Tenhle telefon už klíč má.'

Behaviour: after a successful **password** login, `login.tsx` checks `passkeysEnabled && passkeysUsable()` and `(await listMyPasskeysFn()).length === 0`; if so it navigates to `/klic?redirect=<target>`, else to the target as today. A failure of that check (throw) goes straight to the target. On `/klic`: "Nastavit" → `addPasskey()`; ok → toast `added`, go to target; `already` → toast `already`, go to target; `cancelled` → stay; `failed` → inline `cs.login.failed`, both buttons stay. "Teď ne" → target. Nothing is stored about "Teď ne", so the next password login asks again (Jakub's call). Direct visits with passkeys off: render nothing but go to the target (`beforeLoad` redirect when `getPasskeysEnabledFn()` is false).

- [ ] **Step 1: Failing test**: `tests/screen-guards.test.ts` already fails once the file exists without a gate; add `'/klic'` expectations to `src/lib/nav.test.ts` (everyone may see it, nobody has it in the bar).
- [ ] **Step 2: Run** `pnpm vitest run tests/screen-guards.test.ts src/lib/nav.test.ts` — FAIL.
- [ ] **Step 3: Implement** route, nav entries, login hop; `pnpm dev` once to regenerate `routeTree.gen.ts`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Offer a passkey after a password login`.

### Task 4: Profil: my passkeys

**Files:**
- Create: `src/components/auth/PasskeyList.tsx`
- Modify: `src/routes/_app/profil.tsx`, `src/lib/strings.ts`, `src/components/auth/auth.test.tsx`

**Interfaces:**
- Consumes: `listMyPasskeysFn`, `removeMyPasskeyFn`, `getPasskeysEnabledFn`, Task 1 `addPasskey`; `PasskeySummary` type; `formatDate`-style helpers from `src/domain/dates.ts` (Prague date, `d. M. yyyy`).
- Produces: `PasskeyList({ items, onRemove })` presentational; `deviceLabel(kind: DeviceKind): string` from `cs.passkeys.device` = `{ iphone: 'iPhone', ipad: 'iPad', android: 'Android', mac: 'Mac', windows: 'Windows', linux: 'Linux', other: 'Jiné zařízení' }`; strings `section` = 'Přihlašování otiskem', `addHere` = 'Přidat tento telefon', `addedOn` = 'Přidán {date}', `lastUsed` = 'Naposledy {date}', `neverUsed` = 'Zatím nepoužit', `remove` = 'Odebrat', `removeConfirmTitle` = 'Odebrat klíč?', `removeConfirmText` = 'Na tomhle zařízení se pak přihlásíš heslem.', `empty` = 'Zatím žádný klíč.'

Behaviour: the Profil loader adds `passkeys: enabled ? await listMyPasskeysFn() : null`. The section shows only when `enabled && passkeysUsable()` **or** the list is non-empty (so a user can still remove keys from a browser without WebAuthn). Each row: device label, added date, last used; "Odebrat" opens a Dialog confirm; confirm → `removeMyPasskeyFn({ data: { passkeyId } })` → `router.invalidate()`. "Přidat tento telefon" → `addPasskey()` with the same toasts as Task 3. `backedUp` is not shown (no UI doc entry).

- [ ] **Step 1: Failing tests**: `PasskeyList renders device label, Prague dates and a remove button per item`; `deviceLabel covers every DEVICE_KINDS entry` (iterate `DEVICE_KINDS`); `empty list shows cs.passkeys.empty`.
- [ ] **Step 2: Run** `pnpm vitest run src/components/auth` — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `List and remove passkeys in Profil`.

### Task 5: Správa: the admin removes a user's passkeys

**Files:**
- Create: `src/components/auth/AdminPasskeys.tsx`
- Modify: `src/routes/_app/sprava.tsx`, `src/lib/strings.ts`, `src/components/auth/auth.test.tsx`

**Interfaces:**
- Consumes: `listPasskeyCountsFn`, `removeUserPasskeysFn`.
- Produces: `AdminPasskeys({ count, name, onRemove })`; strings `admin.count` (Czech plural: 1 'klíč', 2–4 'klíče', 5+ 'klíčů', via a `keysLabel(n)` helper next to the strings), `admin.removeAll` = 'Odebrat klíče', `admin.confirmTitle` = 'Odebrat klíče: {name}?', `admin.confirmText` = 'Telefon tím neodhlásíš. Odhlásí ho až nové heslo.' (Security judge, PR #132), `admin.removed` = 'Klíče odebrány.'

Behaviour: the Správa loader also loads `listPasskeyCountsFn()` (counts work with passkeys off too, so the admin can clean up). A person with `count > 0` shows "N klíčů" and "Odebrat klíče" on their row; confirm Dialog; confirm → `removeUserPasskeysFn({ data: { userId } })` → toast → invalidate. Kept as one component so #134 Admin screen: people (open, may touch the same file) only has to keep one line on the row.

- [ ] **Step 1: Failing tests**: `keysLabel(1|2|4|5|21)` → `1 klíč`, `2 klíče`, `4 klíče`, `5 klíčů`, `21 klíčů`; `AdminPasskeys renders nothing for 0 and the label + button for 3`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `Let the admin remove a user's passkeys`.

### Task 6: Browser test against the built server

**Files:**
- Create: `e2e/passkeys.spec.ts`, `playwright.config.ts`
- Modify: `package.json` (`@playwright/test` 1.63.0 dev, script `"e2e": "playwright test"`), `.github/workflows/ci.yml` (build job: after the smoke step, `pnpm exec playwright install --with-deps chromium` then `pnpm e2e`), `vitest.config.ts` only if it would pick up `e2e/` (it does not: include is `src/**`, `tests/**`), `.gitignore` (`test-results/`, `playwright-report/`), ESLint/tsconfig includes if `e2e/` is outside them.

**Interfaces:**
- Consumes: the whole stack. Demo seed (`TASKMASTER_ENV=preview`, user `tata` / `demo1234`).
- Produces: `playwright.config.ts` with `webServer: { command: 'node .output/server/index.mjs', env: { PORT: '3100', TASKMASTER_ENV: 'preview', DATA_DIR: <tmp dir>, WEBAUTHN_RP_ID: 'localhost', WEBAUTHN_ORIGIN: 'http://localhost:3100' }, url: 'http://localhost:3100/api/health' }`, `use.baseURL`, Chromium only, `launchOptions.executablePath` from `PW_CHROMIUM_PATH` when set (cloud sessions: `/opt/pw-browsers/chromium`).

Test `passkey round trip` (CDP `WebAuthn.enable` + `WebAuthn.addVirtualAuthenticator({ protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true })`):
1. Password login as `tata` → lands on `/klic` → "Nastavit" → lands on tata's home.
2. Profil shows one row "Jiné zařízení" or the platform's label, "Zatím nepoužit".
3. Log out → `/login` shows the passkey button → click → tata's home; Profil now shows "Naposledy …".
4. Corrupt the next `passkeyLoginFn` request body via `page.route` (replace `"type":"public-key"` with `"type":"x"`) → button → `cs.login.failed` shown, still on `/login` (Review Focus 5).
5. Profil → "Odebrat" → confirm → empty text shown; log out → button → `cs.passkeys.unknown` shown (Review Focus 2).
Test `cancel shows nothing`: virtual authenticator with `isUserVerified: false`... (UV fails → server `not_verified` → `failed` text). Cancel itself can't be simulated by CDP; covered by Task 1 unit test.

- [ ] **Step 1: Write** the spec and config.
- [ ] **Step 2: Run** `pnpm build && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e` — Expected: PASS (it runs after Tasks 1–5). Then break one thing on purpose (`isUserVerified: false` in step 1) and see it FAIL, revert.
- [ ] **Step 3: CI** step added; push; Expected: `build` job green with the e2e step's output listing 2 passed.
- [ ] **Step 4: Commit** `Test passkeys end to end in a browser`.

### Task 7: Demo data, docs, cleanup

**Files:**
- Modify: `src/server/passkeys/README.md` (the screens section: where each screen lives; how to try passkeys locally: `pnpm build`, `WEBAUTHN_RP_ID=localhost WEBAUTHN_ORIGIN=http://localhost:3000 TASKMASTER_ENV=preview node .output/server/index.mjs`), `src/server/demo/` — **no change**: previews run with passkeys off, so there is no passkey sample data to seed (CLAUDE.md "each feature PR adds its sample data": nothing to add; stated in the brief).

- [ ] **Step 1:** README section.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` — all green.
- [ ] **Step 3: Commit** `Document the passkey screens`.

After the build: `preview` label (screens change; previews show the "off" state), brief, then Jakub's one-off iPhone test on his PC (steps go in the brief and the thread, with the host as a placeholder).
