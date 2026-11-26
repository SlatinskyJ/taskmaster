# Launch switches in Správa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin sees every launch switch in Správa (section *Funkce*) and turns one on or off, with a confirm step and an audit entry, so features are released in production without SSH.

**Architecture:** One new server function `setSwitchFn` (admin only) on top of a new `setSwitch(db, adminId, key, enabled, at)` in `src/server/features/flags.ts`, which upserts the `feature_flags` row and writes `feature.switched` in one `withAudit` transaction. The Správa loader reads the switches fresh with the existing `getFeaturesFn` (no new read function). The list is built from `FEATURE_KEYS` (code), so a switch with no row shows as off. The app shell's one-hour switch cache moves to `src/lib/featureCache.ts` and gets a `forget()`, so the admin's own app reads the new values at once.

**Tech Stack:** TanStack Start server functions, Drizzle + better-sqlite3, React, radix Dialog, Vitest, Playwright.

**Spec:** issue [#296](https://github.com/SlatinskyJ/taskmaster/issues/296) (Jakub 2026-11-26, project thread); Task 1 writes it into spec §6.

## Global Constraints

- Czech UI text only in `src/lib/strings.ts`; code, identifiers, commits in English.
- Every state change writes its audit entry in the same transaction (`withAudit`).
- Admin only: `requireRole('admin')`; `tests/server-fn-guards.test.ts` `EXPECTED_ROLES` gets `setSwitchFn: 'admin'`.
- A switch with no row reads as off (`getFlags`); unknown rows are ignored and not shown.
- No migration, no schema change, no new dependency, no new launch switch.
- Component tests render static markup only; interactions go in e2e.

## Review Focus

1. **New switch with no DB row** (the case Jakub named): shows *Vypnuto* with a working toggle; turning it on creates the row. Pinned in Task 2 (server) and Task 4 (list built from `FEATURE_KEYS`).
2. **Setting a switch to the value it already has** (double tap, two tabs): no write, no audit entry, still `ok`. Task 2.
3. **Non-admin or a forged key/value**: 403 for other roles (guard test); the validator refuses a key not in `FEATURE_KEYS` and a non-boolean `enabled`. Task 2.
4. **Admin's own stale cache**: after a flip, `context.features` on the admin's next navigation shows the new value without a reload. Task 3 (unit) + Task 5 (e2e reload-free check).
5. **Turning `weekPlan` off** shows the 15-minute warning in the confirm; turning it on does not. Task 4 (unit on the copy chooser).

---

### Task 1: Spec and docs

**Files:**
- Modify: `docs/superpowers/specs/2026-11-16-taskmaster-design.md` (§6, after the *Admin console* bullet; §7 *Admin* line)
- Modify: `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` (§7.5 ASettings row)
- Modify: `src/server/features/README.md` (replace "No admin screen yet." paragraph)

- [ ] **Step 1: Add to spec §6** a bullet:
  `- **Launch switches** (Jakub, 2026-11-26, #296): Správa lists every launch switch the app knows, with a Czech name, one line on what it does and its state (*Zapnuto* / *Vypnuto*). A switch with no stored value is off and still listed. The admin turns one on or off after a confirm; each change is audit-logged with the admin as actor. Others see the change on their next page load (within the hour, because the app caches the switches). No launch switch for this list itself **[call]**.`
  In §7 *Admin* line add "launch switches". In the UI doc §7.5 ASettings row add "launch switches (on/off)".
- [ ] **Step 2: README**: say flips are done in Správa → *Funkce* (audit-logged); keep the `docker exec` command as the fallback (e.g. the admin can't log in), noting hand flips write no audit entry.
- [ ] **Step 3: Commit** `docs: spec for launch switches in Správa (#296)`

### Task 2: `setSwitch` and `setSwitchFn`

**Files:**
- Modify: `src/server/features/flags.ts`
- Modify: `src/server/features/functions.ts`
- Modify: `tests/server-fn-guards.test.ts` (`EXPECTED_ROLES`)
- Test: `src/server/features/flags.test.ts`

**Interfaces:**
- Produces: `setSwitch(db: Db, adminId: string, key: FeatureKey, enabled: boolean, at: Date): { changed: boolean }` (flags.ts).
- Produces: `parseSwitchInput(input: unknown): { key: FeatureKey; enabled: boolean }` (flags.ts, throws `Error('invalid_switch')` otherwise).
- Produces: `setSwitchFn` — POST, `requireRole('admin')`, `.validator(parseSwitchInput)`, handler `setSwitch(getDb(), context.user.id, data.key, data.enabled, new Date())`, returns `{ changed: boolean }`.
- Check the `adminId` type against `CurrentUser.id` and use that type.

- [ ] **Step 1: Failing tests in `flags.test.ts`** (`describe('setSwitch')`):
  - `turns a switch on and logs it with the admin as actor`: on `createTestDb()` with an admin user (use the existing test helper that creates users; see other admin tests), `setSwitch(db, admin.id, 'disputes', true, AT)` → `{ changed: true }`; `getFlags(db).disputes === true`; one audit row `['feature.switched', 'user', admin.id, 'feature', 'disputes', AT]` with `before {enabled:false}`, `after {enabled:true}`.
  - `creates the row of a switch with no row`: delete the `weekPlan` row first; `setSwitch(..., 'weekPlan', true, AT)` → row exists with `enabled true`, `before {enabled:false}` logged.
  - `turns a switch off`: `setSwitch(db, admin.id, 'recurring', false, AT)` → `{ changed: true }`; `getFlags(db)` `toStrictEqual` the migration values with only `recurring` flipped to false; audit `before {enabled:true}`, `after {enabled:false}`, actor the admin.
  - `writes nothing when the switch already has that value`: `setSwitch(..., 'recurring', true, AT)` → `{ changed: false }`, zero new audit rows.
  - `rolls the switch back when the audit write fails`: the `boom` trigger pattern from the existing `setSwitchesIn` test → throws, `getFlags(db).disputes` still false.
  - `parseSwitchInput`: accepts `{ key: 'log', enabled: false }`; throws for `{ key: 'nope', enabled: true }`, `{ key: 'log', enabled: 1 }`, `null`.
- [ ] **Step 2: Run** `pnpm test src/server/features` → FAIL (`setSwitch` not exported).
- [ ] **Step 3: Implement.** Extract the per-key write of `setSwitchesIn` (upsert with `onConflictDoUpdate` + its `feature.switched` entry) into a private `writeSwitch(tx, key, before, enabled, actor, at)` and use it from both. `setSwitch` opens `db.transaction` (not `withAudit`: it throws on an empty entry list, `src/server/audit/audit.ts`), reads `getFlags(tx)[key]`, returns `{ changed: false }` when equal, else calls `writeSwitch` with actor `{ kind: 'user', userId: adminId }`. Update the `setSwitchesIn` doc comment: production switches change in Správa, by migration, or by hand. `parseSwitchInput` lives in flags.ts and is tested in flags.test.ts (no `functions.test.ts`). Add `setSwitchFn` and `EXPECTED_ROLES.setSwitchFn = 'admin'`.
- [ ] **Step 4: Run** `pnpm test src/server/features tests/server-fn-guards.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: admin sets a launch switch, audit-logged (#296)`

### Task 3: Switch cache with `forget`

**Files:**
- Modify: `src/lib/clientCache.ts` (return value gets `forget(): void`)
- Create: `src/lib/featureCache.ts`
- Modify: `src/routes/_app.tsx` (import `loadFeatures` from it)
- Test: `src/lib/clientCache.test.ts`

**Interfaces:**
- Produces: `clientCache<T>(...)` returns `(() => Promise<T>) & { forget(): void }`.
- Produces: `featureCache.ts` exports `loadFeatures: () => Promise<Features>` (the cache moved from `_app.tsx`, same 1 h) and `forgetFeatures(): void`.

- [ ] **Step 1: Failing test** `forget drops the cached value`: fetch counter; call, call → 1 fetch; `forget()`; call → 2 fetches.
- [ ] **Step 2: Run** `pnpm test src/lib/clientCache.test.ts` → FAIL.
- [ ] **Step 3: Implement**; move `loadFeatures` out of `_app.tsx` unchanged (keep its comment).
- [ ] **Step 4: Run** → PASS; `pnpm typecheck`.
- [ ] **Step 5: Commit** `refactor: switch cache can be forgotten (#296)`

### Task 4: *Funkce* card in Správa

**Files:**
- Create: `src/components/shell/SwitchRow.tsx` (the row switch now inline in `profil.tsx`, extracted: `SwitchRow({ id, label, hint, checked, onToggle, disabled? })`, same markup and classes)
- Modify: `src/routes/_app/profil.tsx` (use `SwitchRow`; no visual change)
- Create: `src/components/admin/FeaturesCard.tsx`, `src/components/admin/featureSwitch.ts`
- Modify: `src/routes/_app/sprava.tsx` (loader adds `switches: loadSwitches(() => getFeaturesFn())` — `loadSwitches<T>(fetch): Promise<T | { error: 'failed' }>` in featureSwitch.ts, the same catch pattern as `loadFixable`, so a failed read shows the card's error state and the rest of Správa still loads; render `FeaturesCard` last, after the add-person button; confirm `Dialog`)
- Modify: `src/lib/strings.ts` (`cs.admin.features`)
- Test: `src/components/admin/featuresCard.test.tsx`, `src/components/admin/featureSwitch.test.ts`

**Interfaces:**
- Consumes: `setSwitchFn` (Task 2), `forgetFeatures` (Task 3), `FEATURE_KEYS`, `Features`.
- Produces: `switchRows(features: Features): { key: FeatureKey; name: string; hint: string; on: boolean }[]` — one per `FEATURE_KEYS` entry, in that order (featureSwitch.ts).
- Produces: `confirmCopy(key: FeatureKey, turnOn: boolean): { title: string; body: string; confirm: string }` (featureSwitch.ts).
- Strings (`cs.admin.features`): `title: 'Funkce'`, `on: 'Zapnuto'`, `off: 'Vypnuto'`, `note: 'Ostatní uvidí změnu, až aplikaci znovu otevřou (nejpozději do hodiny).'`, `turnOnTitle(name)` → `` `Zapnout ${name}?` ``, `turnOffTitle(name)` → `` `Vypnout ${name}?` ``, `forFamily: 'Změna platí pro celou rodinu.'`, `weekPlanOff: 'Než ji znovu zapneš, nech ji aspoň 15 minut vypnutou.'`, `confirmOn: 'Zapnout'`, `confirmOff: 'Vypnout'`, `cancel` (reuse an existing Zrušit string if there is one), `done(name, on)` toast, `failed: 'Nepovedlo se. Zkus to znovu.'` (reuse an existing generic error if there is one), and `names: Record<FeatureKey, { name: string; hint: string }>`:
  recurring *Opakované povinnosti* / Šablony, jejich schvalování a změny ceny · log *Zapsat* / Záložka Zapsat: zapsání udělané práce · week *Týden* / Záložka Týden · meeting *Schůzka* / Záložka Schůzka a vyúčtování · periodProposals *Návrhy týdne* / Návrhy na příští a výchozí týden · disputes *Sporné a opravy* / Rozporování a opravy bodů · settleLastDay *Vyúčtovat poslední den* / Běžící týden jde vyúčtovat jen v jeho poslední den · passwordChange *Změna hesla* / Vlastní změna hesla na Profilu · bidRefusals *Nechci a odmítnutí* / „Nechci“ u kluků a odmítnutí rodičem · approveAnywhere *Schvalovat odkudkoli* / Schválení ze stránky úkolu a z Úkolů · reopenBidding *Znovu dohadovat cenu* / Znovu otevřít dohadování u otevřeného úkolu · choreBidding *Cena nové povinnosti* / Dohadování první ceny navržené povinnosti · openRows *Otevírat řádky* / Řádek otevře stránku úkolu nebo povinnosti · descriptions *Popisy* / Popisy u úkolů a povinností · weekPlan *Plán týdne* / Kopie povinnosti na každý den týdne · suggestions *Návrhy zlepšení* / Návrhy z Profilu, admin je posílá na GitHub.
  Builder aligns names with the labels the screens already use (grep `strings.ts`); the UX judge has the last word on wording.

- [ ] **Step 1: Failing tests**
  - `featureSwitch.test.ts`: `switchRows(NO_FEATURES)` has `FEATURE_KEYS.length` rows, keys in `FEATURE_KEYS` order, all `on: false`; `switchRows({...NO_FEATURES, log: true})` has `log` on only; every row has a non-empty `name` and `hint`. `confirmCopy('weekPlan', false).body` contains `weekPlanOff`; `confirmCopy('weekPlan', true).body` and `confirmCopy('log', false).body` do not.
  - `featuresCard.test.tsx` (static markup): renders a region named `Funkce`, one `role="switch"` per key with `aria-checked` matching, the note text; with `failed` it renders `cs.admin.features.failedLoad` and a *Zkusit znovu* button (reuse the existing retry string) and no switches.
  - `featureSwitch.test.ts`: `loadSwitches` returns the value, and `{ error: 'failed' }` when the fetch rejects.
  - `setSwitchFn`'s return is exactly `{ changed: boolean }` (`toStrictEqual` in the flags test on `setSwitch`).
- [ ] **Step 2: Run** `pnpm test src/components/admin/feature` → FAIL.
- [ ] **Step 3: Implement.** Extract `SwitchRow` from Profil first (Profil's tests stay green). `FeaturesCard({ features, onToggle(key, turnOn) })`: `SectionLabel` + `Card` (`aria-labelledby` its heading, like `DefaultWeekCard`) with one `SwitchRow` per `switchRows` entry; the hint line ends with the state word (Zapnuto/Vypnuto) so the state is readable, not only the knob colour; the note under the card. In `sprava.tsx`: tap → `Dialog` with `confirmCopy`; confirm → `setSwitchFn({ data })`; on success `forgetFeatures()`, toast `done`, `router.invalidate()`; on throw toast `failed`, dialog closes, nothing changes. Confirm button disabled while sending (busy state). Layout at 360 px: the name and hint wrap (`break-words`), the switch knob never shrinks (`shrink-0`, as in Profil), the row is at least `min-h-tap`. The knob's transitions keep their `motion-reduce:` opt-outs. `FeaturesCard` takes `failed` and `onRetry` like `FixCard`; string `failedLoad: 'Funkce se nepodařilo načíst.'`.
- [ ] **Step 4: Run** `pnpm test src/components src/routes` → PASS; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** `feat: Funkce card in Správa (#296)`

### Task 5: Browser test

**Files:**
- Create: `e2e/switches.spec.ts`
- Modify: `e2e/suites.ts` (row `{ name: 'switches', spec: 'switches.spec.ts', seed: 'launch' }` with comment "Its own server: it flips switches for good.")

- [ ] **Step 1: Write the test** `admin turns Zapsat on; a taker gets the tab`:
  admin logs in → `/sprava`; region `Funkce` has `FEATURE_KEYS.length` switches, all `aria-checked="false"` (seed `launch` turns every switch off). Tap *Zapsat* → dialog → *Zrušit* → still false. Tap again → *Zapnout* → toast, switch `aria-checked="true"` without a reload. Reload → still true. Tap *Zapsat* again → *Vypnout* → reload → `aria-checked="false"`; turn it on again the same way. Log out, log in as `starsi` → bottom bar has *Zapsat*.
  Fourth test `the admin's own app sees the switch at once`: admin turns *Změna hesla* (`passwordChange`) on, then opens Profil through the avatar link (no reload, no `goto`) → the password form (its first field label from `cs`) is visible. This pins the `forgetFeatures()` call.
  Third test `a giver can't set a switch`: log in as `tata`, call the server function through `page.evaluate` (fetch POST to its URL; see how other e2e specs reach a server function, else drop this test and rely on the guard test plus a unit test of `authorize` for `['admin']`) → 403, switch unchanged.
  Second test `turning Plán týdne off warns about the 15 minutes`: turn `weekPlan` on, then tap again → dialog contains `weekPlanOff`; cancel.
- [ ] **Step 2: Run** `pnpm e2e switches` (check the script name in package.json) → PASS. Take a 360 px screenshot of the card and of the open dialog for the brief and the UX judge.
- [ ] **Step 3: Commit** `test: e2e for launch switches in Správa (#296)`

### Size

About 250 changed lines outside tests (server ~40, cache ~15, SwitchRow extract ~40 net 0, card + dialog ~110, strings ~45, docs ~15). No split.
