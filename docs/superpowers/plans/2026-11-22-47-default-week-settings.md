# Default week settings: stored, edited by the admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** settings half of [#47 Admin screen: settings and disputes](https://github.com/SlatinskyJ/taskmaster/issues/47). The disputes half stays in #47 (it needs #46). This PR says `Part of #47`, not `Closes`.

**Goal:** the default week (length, cutoff weekday + time, lower/upper level) lives in the database, the admin edits it on Správa, and every new period takes the defaults stored at the moment it starts. The running period never changes.

**Why now and first:** Jakub says the current levels (50 / 100) are wrong and gets the real numbers at the family meeting. Today they are code constants, so changing them needs a deploy. This PR makes them data, unflagged, so the admin can type them in. [#43 Proposals for next period and default week settings](https://github.com/SlatinskyJ/taskmaster/issues/43) (givers propose, everyone agrees) comes next as a PR stacked on this one, behind a new `periodProposals` flag. #43 lists #47 as depending on it; the order flips because the storage is shared and the admin path is the smaller, more urgent half. No new values are invented here: the migration seeds today's defaults.

**Architecture:** the rules already exist in `src/domain/periods.ts` (`PeriodDefaults`, `isValidDefaults`, `setDefaults`). This PR adds a one-row table, a small server module `src/server/periods/defaults.ts` (read, admin write with audit), swaps the three `DEFAULT_PERIOD_DEFAULTS` call sites that start periods for the stored value, and adds a "Výchozí týden" card on Správa.

**Tech Stack:** TypeScript strict, Drizzle + better-sqlite3, TanStack Start server functions, React + Tailwind/shadcn, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §3 (admin: global settings), §5.8 (defaults; admin changes them directly; applies only to periods not started yet), §5.10 (settings changes audited). UI: `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §5 (steppers, no typing), §7.5 ASettings.

**Size:** about 330 changed lines without tests and the generated migration (schema ~35, defaults module ~90, server fns ~45, call sites ~15, card ~130, strings ~20).

**Judges:** Rules, Architecture, Security (new admin server function), Tests, UX (new card), Ops (boot plugin and roller read the DB).

## Global Constraints

- Seeded defaults = today's code defaults: **7 days, Sunday 23:59 Europe/Prague, lower 50, upper 100** (spec §5.8). No other numbers anywhere.
- A new default applies only to periods that start after it is saved; the running period's cutoff and levels never change (spec §5.8).
- Only the admin changes the defaults directly (spec §3, §5.8). The admin never counts as a party.
- Every change writes its audit entry in the same transaction: action `settings.changed`, entity `settings`, `before` and `after` = the full defaults.
- Valid defaults = domain `isValidDefaults`: length in whole weeks 7…364 ([call] from #42), weekday 0–6, hour 0–23, minute 0–59, `1 ≤ lower ≤ upper`. Plus `upper ≤ LEVEL_MAX = 999` (ruling 3).
- Czech UI text only in `src/lib/strings.ts`; Prague maths only through `src/domain/dates.ts`; store UTC with `toIsoUtc`.
- Never edit a committed migration. Migration number is whatever follows `main` at build time (Track A's #38 adds one too; whoever merges second renumbers).

## Rulings (spec silent; recorded in the PR brief)

1. **One row, not a history table.** `period_defaults` holds exactly one row (`id = 1`, CHECK). The history is the audit log (`settings.changed` with before/after), as for users. The migration inserts the row with the values above.
2. **A missing row reads as the code defaults** (`DEFAULT_PERIOD_DEFAULTS`), like a missing feature flag reads as off. The migration always writes it, so this only covers a hand-deleted row; a save then inserts it again (upsert), and its audit `before` is `null`, as for a creation.
3. **Upper limit `LEVEL_MAX = 999`** in `src/lib/periodLimits.ts`, checked by the server parser and used as the stepper's max. The domain keeps no maximum (none in the spec); the limit only stops a typo like 10000.
4. **Read at the start, not cached.** The roller reads the stored defaults on every tick; `settlePeriod` reads them itself inside its transaction (its `defaults` parameter goes away). So a save takes effect for the next period that starts, with no restart.
7. **A save first rolls what is due.** Between a cutoff and the roller's next tick (timer lag, the 60 s retry, a host waking from sleep) the period that started at the cutoff is not stored yet. The save therefore runs `rollPeriods(tx, now, <stored defaults before the save>)` inside its transaction before it writes, so a period that has already started (by the clock) is created with the old defaults and never gets the new ones (spec §5.8). Those created periods get their normal `period.created` audit entries.
5. **Pending default proposals** do not exist yet (#43). When they do, an admin save leaves them as they are (domain `setDefaults` comment; #43 owns that).
6. **Hint for the meeting:** the card says the change applies from the next week that has not started. Settling starts the next week at the confirm (spec §5.8), so real levels typed in **before** Táta confirms the settlement apply to the coming week. The brief says this plainly for Jakub.

## Review Focus

1. **Admin saves while a period is running.** The running period keeps its levels and cutoff; the next one (by roll or by settlement) gets the new values. → Task 2 test `a save does not change the running period; the next roll uses it`; Task 2 test `settling after a save starts the next period with the saved defaults`.
2. **Invalid input from a crafted request** (upper < lower, 0, 10 days, weekday 7, 1000 points, strings, extra keys). Refused before any write, no audit row. → Task 3 parser table test; Task 2 test `invalid defaults write nothing`.
3. **A non-admin calls the save function.** 403 by the guard, and the domain refuses `not_admin` again. → Task 3 adds both functions as `'admin'` to `EXPECTED_ROLES` in `tests/server-fn-guards.test.ts`, plus Task 2 test `a giver's save is refused`.
6. **Admin saves after a missed cutoff, before the roller's tick.** The period that started at the cutoff keeps the old defaults. → Task 2 test `a save after a missed cutoff does not reach the period that started at it`.
4. **Row missing (hand-deleted).** Reads as the code defaults; a save recreates it. → Task 2 tests.
5. **Phone at 360 px:** four steppers and the weekday/time row fit with no horizontal scroll; the Uložit button is disabled while nothing changed. → Task 4 component test (disabled state) and the UX screenshot at 360 px.

---

### Task 1: Table and migration

**Files:**
- Create: `src/server/db/schema/periodDefaults.ts`; Modify: `src/server/db/schema/index.ts`
- Generate: `drizzle/00NN_period_defaults.sql` (`pnpm db:generate --name period_defaults`), then append the seed `INSERT` by hand before committing (as 0017 does)
- Test: `src/server/db/period-defaults-schema.test.ts`

**Interfaces:**
- Produces: `periodDefaults` table `period_defaults`: `id integer PK` (CHECK `id = 1`), `length_days`, `cutoff_weekday`, `cutoff_hour`, `cutoff_minute`, `lower_level`, `upper_level` (all integer not null), `updated_at text not null`, `updated_by integer null references users(id)` (null = the migration's seed). CHECKs mirror the Global Constraints (length 7–364 and `% 7 = 0`, weekday 0–6, hour 0–23, minute 0–59, `lower_level >= 1 AND lower_level <= upper_level`). No CHECK for `LEVEL_MAX` (a [call] that may change without a table rebuild, as in templates). `PeriodDefaultsRow` type.
- Seed row: `(1, 7, 0, 23, 59, 50, 100, '<migration time literal>', NULL)`.

- [ ] **Step 1: Failing tests** in `period-defaults-schema.test.ts` on `createTestDb()`: `the migration seeds 7 days, Sunday 23:59, 50/100`; `a second row is refused (id = 1 check)`; `lower > upper, lower 0, length 10, weekday 7 are refused by the checks`.
- [ ] **Step 2:** run `pnpm test src/server/db/period-defaults-schema.test.ts` → FAIL (no table).
- [ ] **Step 3:** write the schema, generate, add the INSERT, run `pnpm db:check` → OK.
- [ ] **Step 4:** tests PASS. **Step 5:** commit `Period defaults table, seeded with today's defaults`.

### Task 2: Server module — read and admin save

**Files:**
- Create: `src/server/periods/defaults.ts`; Modify: `src/server/periods/index.ts`, `src/server/periods/roller.ts`, `src/server/plugins/database.ts`, `src/server/settlement/meeting.ts`, `src/server/settlement/functions.ts`, `src/server/demo/seed.ts` (drop the `defaults` argument of its one `settlePeriod` call; tell the seed thread, #183, before pushing), `src/domain/periods.ts` (export `MAX_LENGTH_DAYS = 364`, used by `isValidDefaults`)
- Test: `src/server/periods/defaults.test.ts`, `src/server/periods/roller.test.ts`, `src/server/settlement/meeting.test.ts`, `src/server/settlement/week.test.ts` (callers drop the argument)

**Interfaces:**
- Produces:
  - `getPeriodDefaults(db: Db | Tx): PeriodDefaults` — the row as domain defaults; `DEFAULT_PERIOD_DEFAULTS` when there is no row (ruling 2).
  - `type SetDefaultsError = PeriodError` (`'not_admin' | 'invalid_settings'` in practice)
  - `writePeriodDefaults(tx: Tx, actor: Actor, defaults: PeriodDefaults, now: Date): void` — the one write path (no role check; callers check): upsert row `id = 1` with `updated_at = toIsoUtc(now)`, `updated_by` = the actor's user id, `writeAudit` `settings.changed` / `settings` / entityId `1`, `before` (null if there was no row) and `after` as `{ lengthDays, cutoff: { weekday, hour, minute }, levels: { lower, upper } }`. #43 reuses it when an agreed default proposal applies.
  - `savePeriodDefaults(db: Db, adminId: number, defaults: PeriodDefaults, now: Date): Result<PeriodDefaults, SetDefaultsError>` — one transaction: `listPeople(tx)`, domain `setDefaults(people, adminId, defaults)`, then `rollPeriods(tx, now, getPeriodDefaults(tx))` (ruling 7), then `writePeriodDefaults`. Saving the same values again is allowed and audited (an explicit admin action).
  - `startPeriodRoller(db: Db, opts?: RollerOptions)` — **drops the `defaults` parameter**; each tick calls `rollPeriods(db, at, getPeriodDefaults(db))`. `rollPeriods` keeps its signature (Track A's job runner calls it). The `[periods] started` log line adds the levels (`… levels 50/100`).
  - `settlePeriod(db, giverId, periodId, shown, now)` — **drops the `defaults` parameter**, reads `getPeriodDefaults(tx)` inside its transaction (ruling 4). `settlePeriodFn` and the demo seed stop passing the constant.

- [ ] **Step 1: Failing tests** (`defaults.test.ts`, fixture with admin, tata, starsi, mladsi):
  - `reads the seeded defaults` → `toEqual(DEFAULT_PERIOD_DEFAULTS)`
  - `reads the code defaults when the row is gone`
  - `admin saves 14 days, Saturday 20:00, 60/120` → `ok`, read back equal, one audit row `settings.changed` with `before` 7/Sun 23:59/50/100 and `after` the new values, actor the admin, `updated_by` = admin
  - `a save recreates a deleted row`
  - `a giver's save is refused` → `not_admin`, row and audit unchanged
  - `invalid defaults write nothing` → `{ lower: 60, upper: 50 }`, `lengthDays: 10` → `invalid_settings`, no audit row
  - `a save does not change the running period; the next roll uses it` → `rollPeriods` at T0 with stored defaults, save 60/120, the running period still 50/100; roll after its cutoff → new period 60/120 with the saved weekday's cutoff
  - `settling after a save starts the next period with the saved defaults` → `savePeriodDefaults` 14 days / 40-80, then `settlePeriod` (no defaults argument) → `next` starts at the confirm, levels 40/80, cutoff Sunday 23:59 two weeks on. The existing meeting test `settling ends the week with the defaults passed in` becomes `... with the stored defaults` (same assertions; the values are stored first).
  - `a save after a missed cutoff does not reach the period that started at it` → roll at T0, then save 60/120 at cutoff + 5 min with no tick in between → the period starting at the cutoff exists after the save with 50/100; the following roll uses 60/120.
  - `a failed audit write rolls the save back` → stub `writeAudit` to throw (as other audit-rollback tests do): row unchanged, error propagates
  - `boundaries`: `upper = lower` ok; `lower = 1` ok; `lengthDays 7` and `364` ok (domain), `0`/`371` refused
- [ ] **Step 2: Roller test** `a tick uses the defaults stored at that tick`: start the roller, save new levels, advance fake time past the cutoff → the created period has the new levels, and the log line names them. Existing roller tests drop the `D` argument (no assertion changes).
- [ ] **Step 3:** run → FAIL. **Step 4:** implement. **Step 5:** `pnpm test src/server/periods src/server/settlement` PASS, `pnpm typecheck` clean. **Step 6:** commit `Stored period defaults: read at each start, admin save with audit`.
- [ ] **Step 7:** before pushing roller.ts, tell the Track A thread ("Build recurring chores and scheduler") the new `startPeriodRoller(db, opts)` signature.

### Task 3: Server functions

**Files:**
- Modify: `src/server/periods/` — create `functions.ts` (screens import server fns from a `functions.ts`, per the ESLint rule); Create: `src/lib/periodLimits.ts`
- Test: `src/server/periods/functions.test.ts`

**Interfaces:**
- Produces:
  - `LEVEL_MAX = 999` and `LENGTH_WEEKS_MAX = MAX_LENGTH_DAYS / 7` (from the domain, so the two can't drift) in `src/lib/periodLimits.ts` (UI and parser share them)
  - `parseDefaults(data: unknown): PeriodDefaults` — exact keys `{ lengthDays, cutoff: { weekday, hour, minute }, levels: { lower, upper } }` (an extra key at any level throws), safe integers only, `upper ≤ LEVEL_MAX`, `lengthDays ≤ MAX_LENGTH_DAYS`; throws `Error('Invalid input')` otherwise (as `parseSettle` does). Domain rules stay in the domain.
  - `getPeriodDefaultsFn` — GET, `requireRole('admin')`, returns `PeriodDefaults`
  - `savePeriodDefaultsFn` — POST, `requireRole('admin')`, validator `parseDefaults`, handler `savePeriodDefaults(getDb(), context.user.id, data, new Date())`, returns `{ ok: true } | { ok: false; error: SetDefaultsError }`
- [ ] **Step 1: Failing parser tests**: valid input passes through; `upper: 999` and `lengthDays: 364` pass (boundaries); each of: missing key, string number, 1.5, `upper: 1000`, `lengthDays: 371`, nested `cutoff` not an object, an extra key (top level and inside `levels`), `null` → throws. Handler shape: `getPeriodDefaultsFn` returns exactly the `PeriodDefaults` keys (no `updated_by`, no row id); `savePeriodDefaultsFn` returns exactly `{ ok: true }` or `{ ok: false, error }`, pinned with `toStrictEqual` on the handler's inner functions.
- [ ] **Step 2:** add `getPeriodDefaultsFn: 'admin'` and `savePeriodDefaultsFn: 'admin'` to `EXPECTED_ROLES` in `tests/server-fn-guards.test.ts`.
- [ ] **Step 3–4:** FAIL → implement → PASS, including `pnpm test tests/server-fn-guards.test.ts`. **Step 5:** commit `Admin server functions for the default week`.

### Task 4: "Výchozí týden" card on Správa

**Files:**
- Create: `src/components/admin/DefaultWeekCard.tsx`, `src/components/admin/defaultWeekForm.ts` (pure form helpers)
- Modify: `src/routes/_app/sprava.tsx` (loader adds `getPeriodDefaultsFn()`; card above Lidé), `src/lib/strings.ts` (`cs.admin.defaults`)
- Test: `src/components/admin/defaultWeek.test.tsx`, `src/components/admin/defaultWeekForm.test.ts`

**Interfaces:**
- Consumes: `getPeriodDefaultsFn`, `savePeriodDefaultsFn`, `LEVEL_MAX`, `LENGTH_WEEKS_MAX`, `ScoreStepper` (has `min`/`max`/`label`; gains optional `lessLabel` / `moreLabel` props, default `cs.tasks.less` / `cs.tasks.more`, so each − / + on this card has its own name, e.g. `Méně: Spodní hranice`), shadcn `Select`, `Input`, `Card`, `Button`, `SectionLabel`, `sonner` toast, `userErrorMessage` pattern.
- Produces: `DefaultWeekCard({ defaults, onSave }: { defaults: PeriodDefaults; onSave: (d: PeriodDefaults) => Promise<string | null> })` (returns an error text or null, like `PersonForm`).
- `defaultWeekForm.ts`: `toTime(h, m): string` (`'23:59'`), `fromTime(s): { hour, minute } | null`, `sameDefaults(a, b): boolean`.

Layout (UI doc §5 steppers, ASettings mockup, 360 px):
- Section label `Výchozí týden`.
- Card rows: **Délka**: a plain − value + stepper (no dial; the dial would show bare week numbers), value text `7 dní` / `14 dní` in an `aria-live="polite"` output, buttons `Kratší` / `Delší` (`size-tap`), steps one week (min 7, max `MAX_LENGTH_DAYS`); **Konec**: weekday `Select` with full names (`pondělí … neděle`, Monday first, mapped to domain 1…6,0) and `<Input type="time">` side by side; **Spodní hranice** and **Horní hranice** `ScoreStepper`s (lower min 1 max `LEVEL_MAX`; upper min = current lower, max `LEVEL_MAX`; raising lower above upper pushes upper up with it).
- Meta line: `Platí od dalšího týdne, který ještě nezačal. Běžící týden se nemění.`
- Tap targets: stepper buttons are `size-tap` (ScoreStepper already), the Select trigger and time input `min-h-tap`, Uložit `size="lg"` full width. No animation added.
- Busy and errors: Uložit shows `cs.admin.saving` and is disabled while the request runs; a refusal or a network error shows its Czech text under the button (network: `cs.admin.defaults.failed`) and the form keeps the values, so Uložit is the retry. The Správa loader already has the route error state (`RouteError`); the card has no empty state (the row always reads, ruling 2). Nothing here is irreversible (a save can be changed back), so no Dialog.
- 360 px: each field has its label above and the control full width under it (as `ScoreField` does), so the levels' swipe dials keep their width; Konec puts the weekday select and the time input side by side (`grid-cols-2`) under its label. Checked on the 360 px screenshot.
- `Uložit` button: disabled while `sameDefaults(form, defaults)` or saving; on success toast `Uloženo`, `router.invalidate()`; on error the Czech message under the button.

Strings (`cs.admin.defaults`): `title: 'Výchozí týden'`, `length: 'Délka'`, `days: (n) => \`${n} dní\``, `shorter: 'Kratší'`, `longer: 'Delší'`, `less: (field) => \`Méně: ${field}\``, `more: (field) => \`Více: ${field}\``, `cutoff: 'Konec'`, `weekday: 'Den'`, `time: 'Čas'`, level labels reuse `cs.meeting.level.lower` / `.upper` (no copies), `hint` (above), `weekdayNames: ['neděle','pondělí','úterý','středa','čtvrtek','pátek','sobota']` (Sunday first like `Weekday`; the list orders them Monday first), `failed: 'Uložení se nepovedlo. Zkus to znovu.'`, errors `invalidSettings: 'Takhle to nejde: horní hranice musí být aspoň spodní.'`, `notAdmin` reuses `cs.admin.errors.notAdmin`.

- [ ] **Step 1: Failing tests**:
  - form helpers: `toTime(23, 59) === '23:59'`, `toTime(8, 5) === '08:05'`, `fromTime('20:00')` → `{20, 0}`, `fromTime('')` → null, `sameDefaults` true/false.
  - route: `src/routes/_app/sprava.tsx` page test renders the card from the loader (real entry point, as `schuzkaPage.test.tsx` does)
  - card: shows `Ukládám…` and a disabled button while `onSave` is pending; a network failure (rejected promise) shows the generic error and keeps the values
  - card: renders `7 dní`, `neděle`, `23:59`, `50`, `100` from the seeded defaults; Uložit disabled until a change; `+` on Délka shows `14 dní` and enables Uložit; picking `sobota` + `20:00` and lower 60 / upper 120 each − / + has its own accessible name (`Méně: Spodní hranice`, `Kratší`, …); calls `onSave` with `{ lengthDays: 14, cutoff: { weekday: 6, hour: 20, minute: 0 }, levels: { lower: 60, upper: 120 } }`; raising lower above upper raises upper; an error string from `onSave` is shown.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** `pnpm lint && pnpm typecheck` clean. **Step 6:** commit `Správa: edit the default week`.

### Task 5: End to end

**Files:** Create `e2e/default-week.spec.ts`; Modify `playwright.config.ts`: a project `default-week` with `testMatch: 'default-week.spec.ts'` and its own server (port 3105, own data folder), since the save is stored and must not leak 60/120 into other specs. If the per-suite seed setup from [#183](https://github.com/SlatinskyJ/taskmaster/issues/183) has landed first, use its way of adding a suite instead.

- [ ] **Step 1:** `admin changes the default week`: log in as `admin` / `demo1234`, Správa shows `Výchozí týden` with `7 dní`, `ne`, `23:59`, `50`, `100`; set lower 60 and upper 120, Uložit → toast `Uloženo`; reload → 60 / 120 stay. Then log in as `tata` and open `/tyden` directly (the `week` flag only hides the tab): it still shows this week's levels 50 / 100 (the running week never changes). Always asserted.
- [ ] **Step 2:** `pnpm build && pnpm exec playwright test e2e/default-week.spec.ts --trace off` PASS. **Step 3:** commit `E2E: admin edits the default week`.

### Task 6: Finish

- [ ] Full `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm db:check` green.
- [ ] Delete this plan file in its own commit; write the brief (skill `pr-brief`); add `preview`; mark ready; code rounds (skill `pr-review-rounds`).
