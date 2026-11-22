# Per-suite seed data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each browser-test suite boots its own server on its own database, seeded with only the data that suite needs, so a new feature's demo data never changes another suite's numbers. Each seed also turns on the launch switches (`feature_flags`, #163) it needs, so a feature behind a switch is never blocked on its preview or in its tests. Previews and dev keep the full demo seed, with every switch on.

**Architecture:** The demo seed is split into named **pieces** (one per feature's sample data). A **seed** is a named, ordered list of pieces; `TASKMASTER_SEED` picks one at boot (default `demo`, the full list previews get today). `playwright.config.ts` gets one table row per spec file: its own port, server, data folder and seed. A seed also lists the launch switches it turns on: `demo` turns on all of them (Jakub 2026-11-22: agents working behind switches must not get blocked on previews), the launch suite none. The guards (preview flag, `ADMIN_PASSWORD`, empty DB) and the all-or-nothing transaction stay exactly as today.

**Tech Stack:** TypeScript, Drizzle/SQLite, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §6 (first admin / demo seed, line "Dev, PR previews and E2E get their test family from the demo seed"). Unchanged: every seed starts with the same family and password, under the same guards. Issue: [#183](https://github.com/SlatinskyJ/taskmaster/issues/183); Jakub's ask (2026-11-21): "The different test suites doesn't have to share the data. We can build a structure around it."

## Global Constraints

- Czech only in UI text; seed titles are sample data (Czech), code and names English.
- Every seed write goes through the real actions (`createTask`, `approveTask`, … with `Tx`), so every state change is audit-logged in the seed's one transaction.
- The demo seed for previews must produce the same data as today, except the #183 rename below.
- No new dependency, no migration, no schema change.
- `TASKMASTER_SEED` is read only when `TASKMASTER_ENV=preview`; production never reads it.

## Review Focus

1. Unknown or misspelt `TASKMASTER_SEED` (e.g. `Home`): the boot must fail loudly, naming the known seeds, and seed nothing. Never a silent fallback to `demo`, or a suite would run on the wrong data and pass or fail for the wrong reason. Test in Task 1.
2. `TASKMASTER_SEED` set without the preview flag, or with `ADMIN_PASSWORD`: still `not_preview` / `admin_password_set`, nothing seeded, no throw for an unknown name. Test in Task 1.
3. Empty `TASKMASTER_SEED=""` (a CI env line left blank): treated as unset → `demo`. Test in Task 1.
4. Audit log in time order for every seed, not only `demo` (pieces with a past week write at `start`). Test in Task 1, over all seeds.
5. Two specs sharing one server again by accident: the config builds servers from the suite table only, one per row, each with a fresh `mkdtempSync` folder. Checked in Task 3 by a config test.

---

## File Structure

- `src/server/demo/seed.ts` (modify): guards, family, transaction, `seedDemo`, `describeDemo`. Picks the seed by name. Loses the feature data.
- `src/server/demo/pieces.ts` (create): `SeedContext`, the shared helpers (`step`, `doChore`), and one exported piece per feature: `pastWeek`, `negotiation`, `priceChange`, `cancelled`, `points`, `templates`, `thisWeek`. Bodies moved from `seed.ts`.
- `src/server/demo/seeds.ts` (create): `SEEDS` registry and `SeedName`.
- `src/server/features/flags.ts` (modify): `switchOnIn(tx, keys, at)`, audit-logged. `README.md` there: previews have every switch on through the demo seed; production still only by migration or hand.
- `src/server/audit/actions.ts` (modify): action `feature.switched`, entity type `feature` (TS lists only; no DB check, no migration).
- `src/server/demo/index.ts` (modify): also export `SEEDS`, `SeedName`.
- `src/server/demo/seed.test.ts` (modify): guards, picking, all-or-nothing, per-seed invariants.
- `src/server/demo/demo.test.ts` (create): what previews get (today's content tests, moved).
- `src/server/demo/suites.test.ts` (create): the numbers each e2e suite's seed must give (pinned next to the seed, so a seed change fails a unit test before the browser test).
- `playwright.config.ts` (modify): suite table.
- `e2e/*.spec.ts` (modify): expected numbers for their own seeds; header comments name the seed.
- `CLAUDE.md` (modify, one line): "Demo data" bullet explains pieces, seeds and `TASKMASTER_SEED`.

---

### Task 0: Turning switches on from code, audit-logged

**Files:** Modify `src/server/features/flags.ts`, `src/server/features/flags.test.ts`, `src/server/audit/actions.ts`, `src/server/features/README.md`.

**Interfaces:**
- Produces: `switchOnIn(tx: Tx, keys: readonly FeatureKey[], at: Date): void`. For each key not already on: upsert the row to `enabled = true` and `writeAudit(tx, { actor: { kind: 'system' }, action: 'feature.switched', entityType: 'feature', entityId: key, before: { enabled: false }, after: { enabled: true }, at })`. A key already on writes nothing. No "off" counterpart (YAGNI: nothing seeds a switch off; the migration's rows are off).

- [ ] **Step 1: Failing tests** in `flags.test.ts`: `'switchOnIn turns the listed switches on and logs each'` (`['week', 'meeting']` → `getFlags` has those two on, the others off; two `feature.switched` entries, actor system, entity ids `week`, `meeting`); `'a switch already on writes nothing'` (second call adds no audit row); `'a missing row is created'` (delete the `log` row first, `switchOnIn(['log'])` → on).
- [ ] **Step 2: Run** `pnpm test src/server/features` → fail (no `switchOnIn`).
- [ ] **Step 3: Implement**; add `'feature.switched'` and `'feature'` to the lists in `actions.ts`. README: a new paragraph "Previews and tests" replacing "Previews start from the same migrations, so every switch is off there too": the demo seed turns every switch on (`TASKMASTER_SEED` unset); each e2e seed lists its own; production only by a migration or by hand, as before.
- [ ] **Step 4: Run** `pnpm test src/server/features src/server/audit && pnpm typecheck` → pass.
- [ ] **Step 5: Commit** `Turn launch switches on from code, audit-logged (#183)`.

### Task 1: Pieces, seeds and picking by name

**Files:** Create `src/server/demo/pieces.ts`, `src/server/demo/seeds.ts`, `src/server/demo/demo.test.ts`. Modify `src/server/demo/seed.ts`, `src/server/demo/index.ts`, `src/server/demo/seed.test.ts`.

**Interfaces:**
- Produces:
  - `type SeedContext = { tx: Tx; id: (username: string) => number; now: Date; start: Date }` (`start` = `now − 7 days`, as today).
  - `type Piece = (ctx: SeedContext) => void`; pieces `pastWeek`, `negotiation` (Umýt auto with bids 25/22, Uklidit sklep, Vyluxovat reserved to Starší), `priceChange` (Shrabat listí, Táta's 12 waiting), `cancelled` (Umýt okna v kuchyni), `points` (#40), `templates` (#37/#138), `thisWeek` (#44).
  - `type Seed = { pieces: readonly Piece[]; features: readonly FeatureKey[] }`.
  - `const SEEDS = { family: { pieces: [], features: [] }, home: { pieces: [negotiation, points], features: [] }, tasks: { pieces: [priceChange], features: [] }, week: { pieces: [pastWeek, thisWeek], features: ['week', 'meeting'] }, demo: { pieces: [pastWeek, negotiation, priceChange, cancelled, points, templates, thisWeek], features: FEATURE_KEYS } } as const satisfies Record<string, Seed>`; `type SeedName = keyof typeof SEEDS`. `demo` keeps today's order, so its audit log reads the same. `demo` uses `FEATURE_KEYS` itself, so a new switch is on in previews without touching the seed.
  - After the pieces, in the same transaction, `seedDemo` calls `switchOnIn(tx, seed.features, now)` (Task 0).
  - `DemoOutcome` seeded variant gains `seed: SeedName`: `{ kind: 'seeded'; seed: SeedName; usernames: string[] }`.
  - `seedDemo(db, env, now)` unchanged signature. After the preview and `ADMIN_PASSWORD` guards, `name = env.TASKMASTER_SEED || 'demo'`; if not a key of `SEEDS`, throw `Error('Demo seed: unknown TASKMASTER_SEED "<name>" (known: family, home, tasks, week, demo)')` before any write.
  - `describeDemo` seeded message: `[demo] seeded <seed>: admin, tata, starsi, mladsi (password "demo1234")`.

- [ ] **Step 1: Move today's content tests** ('seeds a task in negotiation…', 'gives both brothers points…', 'adds two templates…', 'leaves a score change in flight…', 'demo seed gives a meeting…', 'a settled past week…', and the full audit-order test of the first case) from `seed.test.ts` to `demo.test.ts`, unchanged except: they call `seedDemo(db, PREVIEW, T0)` (no `TASKMASTER_SEED`, so `demo`), and #183:
  - the week's Mladší chore "Uklidit pokoj" (25) becomes **"Uklidit pokoj po návštěvě"** (25), so the two confirmed "Uklidit pokoj" rows are told apart;
  - new test `'every demo task by title and state (#183)'`: `listTasks(db).map((t) => [t.title, t.status]).sort()` equals the full sorted list of all 28 demo tasks with their states (fill from a run of the unchanged seed, then check each against the piece that makes it), replacing the proposed/reserved-only filter as the title check for #40's confirmed, pending and open tasks.
- [ ] **Step 2: Write the failing tests in `seed.test.ts`:**
  - `'TASKMASTER_SEED picks the seed; unset or empty is demo'`: for `undefined` and `''` the outcome is `{ kind: 'seeded', seed: 'demo', … }`; with `'family'` it is `seed: 'family'` and `tasks`, `templates`, `periods`, `settlements` tables are empty, 4 users.
  - `'an unknown TASKMASTER_SEED fails the boot and seeds nothing'`: `'Home'` and `'nope'` throw `/unknown TASKMASTER_SEED "Home".*known: family, home, tasks, week, demo/`; users and audit log empty.
  - `'TASKMASTER_SEED never matters outside a preview'`: `{ TASKMASTER_SEED: 'nope' }` → `not_preview`; `{ ...PREVIEW, ADMIN_PASSWORD: 'x', TASKMASTER_SEED: 'nope' }` → `admin_password_set`; no throw.
  - `'each seed turns on its switches and only those'`: `demo` → `getFlags` equals `ALL_FEATURES`; `week` → week + meeting on, recurring + log off; `family`, `home`, `tasks` → `NO_FEATURES`.
  - `'every seed: the family logs in and the audit log is in time order'`: loop over `Object.keys(SEEDS)`; login for all four roles ok; audit `at` sorted.
  - Keep: refuses without preview, refuses non-empty, refuses with `ADMIN_PASSWORD`, both all-or-nothing tests, second boot, boot messages (update the seeded message assertion to contain the seed name).
- [ ] **Step 3: Run** `pnpm test src/server/demo` → the new seed tests fail (no `SEEDS`, no `seed` in outcome), the rename test fails.
- [ ] **Step 4: Implement** `pieces.ts`, `seeds.ts`, new `seed.ts` as in Interfaces. Pieces are today's bodies moved as they are; `seedPoints`' doc comment says what this piece alone gives (Starší 40 confirmed + 12 pending, Mladší 55; #183). The `seed.ts` header comment explains pieces/seeds: previews get `demo`; each e2e suite names its seed in `playwright.config.ts`; a feature PR adds its piece to `demo` and, if its suite needs it, to that suite's seed.
- [ ] **Step 5: Run** `pnpm test src/server/demo && pnpm typecheck && pnpm lint` → pass.
- [ ] **Step 6: Commit** `Split the demo seed into pieces and named seeds (#183)`.

### Task 2: Pin each suite's numbers

**Files:** Create `src/server/demo/suites.test.ts`.

**Interfaces:** Consumes `seedDemo`, `SEEDS` (Task 1). Each test seeds with `{ ...PREVIEW, TASKMASTER_SEED: '<name>' }` at `T0`, then (where periods matter) rolls periods at `T0 + 1 min` as the boot does.

- [ ] **Step 1: Write the tests** (values from the pieces, checked by hand):
  - `home`: `takerPoints` → `[['Starší', 40, 12], ['Mladší', 55, 0]]`; tasks by state: proposed Umýt auto, Uklidit sklep; reserved Vyluxovat celý obývák a chodbu; open Umýt okna v obýváku i v ložnici; pending Vytřít podlahu v kuchyni; confirmed Vynést tříděný odpad, Uklidit pokoj, Umýt nádobí, Pověsit prádlo. No periods besides the boot's, no templates.
  - `tasks`: only Shrabat listí na zahradě, open at 10, `scoreChange` 12 waiting for Starší and Mladší.
  - `week`: settlements of the past week `[starsi 108 upper 100 8], [mladsi 50 lower 50 0]`; meeting totals `[['Starší', 120], ['Mladší', 47]]` (8 carried + 40 + 50 + 22; 25 + 12 + 10); pending `[['Zalít kytky', 2, 'Starší'], ['Vynést tříděný', 3, 'Mladší']]`; one rejection (Vynést sklo a plasty do kontejneru, Mladší).
  - `family`: 4 users, nothing else.
- [ ] **Step 2: Run** `pnpm test src/server/demo/suites.test.ts` → pass (Task 1 built the seeds). If a number differs, the hand count is rechecked against the piece before the test is changed.
- [ ] **Step 3: Commit** `Pin the numbers each e2e seed gives (#183)`.

### Task 3: One server per suite

**Files:** Modify `playwright.config.ts`, all `e2e/*.spec.ts`, `CLAUDE.md`.

**Interfaces:** Consumes `SeedName` (type-only import from `src/server/demo/seeds`).

- [ ] **Step 1: Suite table** in `playwright.config.ts`: `const SUITES: readonly { name: string; spec: string; seed: SeedName; env?: Record<string, string> }[]`, rows in this order (port = `3100 + index`):

  | name | spec | seed | extra env |
  | --- | --- | --- | --- |
  | on | passkeys.spec.ts | family | `WEBAUTHN_RP_ID=localhost`, `WEBAUTHN_ORIGIN=http://localhost:<port>` |
  | off | passkeys-off.spec.ts | family | `DATA_DIR=$TM_E2E_OFF_DATA_DIR` (spec writes a passkey row) |
  | home | home.spec.ts | home | |
  | launch | launch.spec.ts | home | (no switches on: this suite pins the launch look) |
  | tasks | task-page.spec.ts | tasks | |
  | week | week.spec.ts | week | |
  | meeting | meeting.spec.ts | week | |

  Switches come from the seed (Task 1), not from the table. `projects` and `webServer` are both `SUITES.map(...)`; each server gets `TASKMASTER_SEED=<seed>` and its own `mkdtempSync` folder unless the row sets `DATA_DIR`. Comment: one spec file per row; a new spec gets a new row, never a second `testMatch` entry.
- [ ] **Step 2: Specs to their own seeds:**
  - `home.spec.ts`: back to #41's numbers: Starší `40 … 12`, after his Hotovo `40 … 17`, "Do spodní hranice chybí 10 bodů."; Mladší `55 … 0`, "Do horní hranice chybí 45 bodů."; Táta sees `40/17`, `55/0`, approves Vytřít (`52 … 5`) and Umýt okna (`57 … 0`, no "Ke schválení" left); Úkoly groups `[groupProposed, reserved, confirmed]`. Drop the "Zalít kytky" line and the #172 note.
  - `meeting.spec.ts`: approve Zalít kytky and Vynést tříděný; settle: Starší **122**, horní; plan step Starší **22**, Mladší **0** (50 is exactly spodní).
  - `week.spec.ts`: `120 ✔` (was 160) for Starší, `47 ✔` (was 102) for Mladší in Táta's view and in Starší's "not" check; history lines unchanged.
  - `task-page.spec.ts`, `launch.spec.ts`, `passkeys*.spec.ts`: only the header comment names the seed.
- [ ] **Step 3: Run** `pnpm build && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium… pnpm e2e --trace off` → all 7 projects pass. On a red spec: `superpowers:systematic-debugging`, compare with Task 2's pinned numbers first.
- [ ] **Step 4: CLAUDE.md** "Demo data" bullet: add "The seed is built from pieces (`src/server/demo/pieces.ts`); `TASKMASTER_SEED` picks a named list of them (`seeds.ts`, default `demo`). Each e2e spec file has its own row in `playwright.config.ts`: own server, own DB, own seed. A feature PR adds its piece to `demo`, and gives its e2e suite the seed it needs. A seed lists the launch switches it turns on (`demo`: all); a feature behind a switch adds it to its suite's seed, so it is never blocked in tests or on its preview."
- [ ] **Step 5: Commit** `Give each e2e suite its own server and seed (#183)`.

## Rulings for the brief

- `demo` turns every switch on, so previews show the whole app, not the launch look. The launch look stays pinned by the `launch` e2e suite (switches off). From Jakub's 2026-11-22 ask that agents behind switches are not blocked on previews.
- `meeting` reuses the `week` seed on its own server: same data, separate database.

## Size

About 150 changed lines outside moves and tests: `seed.ts` + `seeds.ts` + config table + CLAUDE.md. `pieces.ts` is ~190 lines moved from `seed.ts` (git shows it as new). Well under 400 counted lines.
