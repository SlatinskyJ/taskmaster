# Week plan table on Týden Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (CLAUDE.md, PR flow step 3). Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#258 Week plan table on Týden](https://github.com/SlatinskyJ/taskmaster/issues/258)

**Goal:** Takers and givers open a "Plán týdne" table from Týden: chores × days of the running period. A taker reserves a day with one tap, and every other tap opens that copy's task page.

**Architecture:** One read, `getWeekPlan(db, now)` in `src/server/instances/weekPlan.ts`, turns the running period and its week copies (`tasks.plan_day_at`, from #257) into columns and cells. It is served by `getWeekPlanFn` (giver, taker), behind the `weekPlan` switch. There are no new writes. A tap reuses `reserveTaskFn` / `releaseTaskFn` through `useTaskAction`, so the day rules (`getFlags(db).weekPlan`), the audit entries and the "first tap wins" refusal (`wrong_state`) are the ones #257 already tests. A pure module (`planView.ts`) decides each cell's look and what a tap does. A hook-free view component draws the table and is reused by the meeting's step 3 in #259 (out of scope here). The screen is the route `/tyden/plan`, opened from a card on Týden.

**Tech Stack:** TanStack Start (routes, server functions), Drizzle + SQLite, React, Tailwind v4 (`portrait:` / `landscape:` variants), vaul `Drawer`, sonner, Vitest (static markup), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.12 "The plan table (Týden)" (and §5.12 generally, §5.4 reservation, §5.6 states). UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §7.1 row "Plan", §2.2 state colours, §6 navigation. The look is Jakub's approved wireframes (Design canvas, 2026-11-26): boards 1 Týden entry, 2 landscape, 3 Uvolnit sheet, 4 portrait, 5 several copies. Board 6 (Schůzka) belongs to #259.

**Expected size:** about 560 changed lines without tests, migrations and generated files (server read + function 130, `planView.ts` 80, table + sheets 220, route 40, Týden card and loader 30, nav/strings/Avatar 45, demo piece + seed + suite 65). There is no migration. That is over the 400 goal and under 600. It stays **one PR** for these reasons:
- the server read has no caller without the screen, so a server-only bottom PR would be dead code that the judges read twice (once alone, once with its screen);
- the read's shape is pinned by the screen's needs, and the two change together.
If the Architecture judge still asks for a split, the cut is: bottom PR = Tasks 1–2 (read, function, demo piece, seed); top PR = Tasks 3–7.

**Approved defaults from Jakub (2026-11-26):**
- the entry is a "Plán týdne" card on Týden, with no new bottom-bar tab;
- on a portrait phone the days scroll sideways, with the chore-name column pinned **outside** the scroll area, plus a "turn the phone" hint; landscape fits every day;
- a taker tapping his own reserved cell gets a sheet with only Uvolnit and Zavřít (plus an "Otevřít úkol" link, as on board 3); Hotovo stays on the task page;
- the table is a reusable component for Schůzka step 3 (#259), and #259 itself is not built here.

## Global Constraints

- Czech UI text only in `src/lib/strings.ts` (new namespace `cs.plan`). Code, identifiers and commits in English.
- Behind the launch switch `weekPlan` (`src/lib/features.ts`). Off: no card on Týden; `/tyden/plan` redirects to `/tyden`; `getWeekPlanFn` answers `{ error: 'feature_off' }`.
- All Prague day maths through `src/domain/dates.ts` (`startOfPragueDay`, `addPragueDays`, `toPragueWallTime`); instants travel as UTC ISO (`toIsoUtc`).
- Theme tokens only (UI doc §2): state colours through `src/components/tasks/stateStyles.ts` classes (`STATE_DOT`, `STATE_TEXT`, `STATE_CHIP_BG`); no hex in components. Light and dark both work from the tokens.
- Tap targets ≥ 44 px (`min-h-tap`, `size-tap`). Every animation has a `motion-reduce:` opt-out.
- Component tests render static markup only; interactions are tested in e2e (CLAUDE.md).
- No new dependency. No schema change. No new state change: reserve and release are #257's own actions with their own audit entries.
- The e2e suite gets its own seed and row in `e2e/suites.ts`; the demo seed gets the new piece.
- The keyboard rule does not apply: the screen has no text field.

## Review Focus

1. **A Sunday-evening meeting week has 8 day columns.** Start Sunday (the part left after 20:00) plus Monday–Sunday. Landscape must still fit every column at ≥ 44 px, and the grid must not hard-code 7. Tests: Task 1 test `eight columns after a Sunday 20:00 start`; Task 4 test `grid has one column per day`; e2e Task 7 runs landscape with whatever the seed's week has.
2. **The table is stale: the brother took the cell meanwhile.** The tap must say so in Czech and reload, not fail silently. Test: e2e Task 7 `a stale free cell says someone was faster and shows his avatar`.
3. **A double tap while the first reserve is in flight.** Only one request may go out, and the busy cell shows it is working. Test: Task 4 `busy: every cell disabled, the busy one aria-busy`.
4. **A chore agreed mid-week.** Its row appears, blank on the days before its first copy. A proposed chore and a chore with no days never get a row. Test: Task 1 `rows: active templates with days only, in Czech title order`.
5. **A week across the October DST change.** Columns stay one per Prague calendar day (no duplicate or missing day). Test: Task 1 `DST week 2026-10-25: one column per Prague day`.

---

## File Structure

| File | Role |
| --- | --- |
| Create `src/server/instances/weekPlan.ts` | `getWeekPlan(db, now): WeekPlan` and its types: columns, rows, cells. Read-only. |
| Modify `src/server/instances/functions.ts` | `weekPlanHandler(db, now)`, `getWeekPlanFn` (GET, giver + taker). |
| Create `src/components/week/planView.ts` | Pure: cell kind, tap action, past/today, free count, labels (aria, header, list row). |
| Create `src/components/week/WeekPlanTable.tsx` | `WeekPlanTableView` (hook-free: pinned names, scrolling days, cells, legend) and `WeekPlanTable` (state: busy, open sheet; calls `useTaskAction`). Reused by #259. |
| Create `src/components/week/PlanSheets.tsx` | `ReleaseSheet` (Uvolnit / Zavřít / Otevřít úkol) and `CopyListSheet` (several copies on one day). |
| Create `src/routes/_app/tyden/plan.tsx` | Route `/tyden/plan`: guard, switch redirect, loader, `Screen` with back to `/tyden`. |
| Modify `src/routes/_app/tyden/index.tsx`, `src/components/week/WeekScreen.tsx` | `PlanCard` above the Tento týden / Historie tabs, with the free count; the loader reads the plan only with the switch on. |
| Modify `src/lib/nav.ts` | `'/tyden/plan'` in `APP_PATHS`, roles `['taker', 'giver']`. |
| Modify `src/lib/strings.ts` | `cs.plan`. |
| Modify `src/components/shell/Avatar.tsx` | `size="sm"` (26 px initial for a cell; the avatar is decoration, the cell is the tap target). |
| Modify `src/server/demo/pieces.ts`, `src/server/demo/seeds.ts`, `e2e/suites.ts` | Piece `planTable`, seed `plantable`, suite `week-plan`. |
| Create `e2e/week-plan.spec.ts` | Portrait, landscape, taps, stale cell, giver, several copies. |
| Generated `src/routeTree.gen.ts` | By the router plugin on `pnpm build`. |

---

### Task 1: The plan read (`getWeekPlan`)

**Files:**
- Create: `src/server/instances/weekPlan.ts`
- Test: `src/server/instances/weekPlan.test.ts` (uses `weekFamily`, `prague`, `setWeekPlan` from `./testing`, `must`, `row` from `~/server/tasks/testing`)

**Interfaces:**
- Consumes: `currentPeriod(db, now)` (`~/server/periods`), `maskToDays` (`~/server/templates/rules`), `startOfPragueDay`, `addPragueDays`, `toIsoUtc`, `parseIsoUtc` (`~/domain/dates`); tables `templates`, `tasks`, `users`.
- Produces (exported, used by Tasks 2–6):

```ts
export type PlanCopyStatus = 'open' | 'reserved' | 'done_unconfirmed' | 'confirmed' | 'expired'

export interface PlanCopy {
  id: number
  status: PlanCopyStatus
  score: number
  origin: 'scheduled' | 'on_demand'
  /** UTC ISO: when the copy was made (an on-demand extra's time in the list sheet). */
  createdAt: string
  /** reserved: who holds it; done_unconfirmed / confirmed: who did it; open / expired: null. */
  person: { id: number; name: string } | null
}

export interface PlanRow {
  templateId: number
  title: string
  /** The template's schedule weekdays (0 = Sunday), ascending. */
  scheduleDays: Weekday[]
  /** One entry per `WeekPlan.days`: that day's copies, oldest first (createdAt, then id). [] = blank. */
  cells: PlanCopy[][]
}

export interface WeekPlan {
  /** The running period; null before the first one (the table is empty). */
  period: { startsAt: string; cutoffAt: string } | null
  /** UTC ISO start of today's Prague day (past days and today's column are decided from it). */
  today: string
  /** UTC ISO start of each column's Prague day, in order. */
  days: string[]
  rows: PlanRow[]
}

export function getWeekPlan(db: Db | Tx, now: Date): WeekPlan
```

**Rules the code follows (spec §5.12, plus the decisions marked "plan"):**
- No running period → `{ period: null, today, days: [], rows: [] }`.
- Columns: each Prague day `d` from `startOfPragueDay(startsAt)` while `d < cutoffAt`, stepping with `addPragueDays(d, 1)`. A day starting exactly at `cutoffAt` is not a column.
- Rows: templates with `status = 'active'` and `scheduleDays > 0`, sorted by `title` with `localeCompare(…, 'cs')`, then by id (plan). Proposed templates and templates without days have no row (spec [call]).
- Copies: tasks of those templates with `plan_day_at` equal to one of the columns. Cancelled copies are left out, so a day whose only copy was cancelled is blank, and a cancelled start-day copy does not keep the start-day column (plan; asked Jakub 2026-11-26, blank is the default until he answers). Rows without `plan_day_at` are left out: old-rule instances and self-logs. `week_rules` is not read: a copy keeps its day for display after the switch drops its rules (#257 comment in `weekRules.ts`).
- Start day (spec [call] "only if a copy of it is still in the period"): a start-day copy that reached its end before `startsAt` belongs to the old week and is left out: done or confirmed with `completedAt < startsAt`, or expired with `graceEndsAt < startsAt` (a deadline copy; a no-deadline copy expires only after its day ends, which is after `startsAt`). If the period does not start at a Prague midnight and no start-day copy is left, the first column is dropped. A period starting at 00:00 always keeps its start day.
- `person`: reserved → `reservedBy`; done_unconfirmed / confirmed → `completedBy` (a parent's "Hotovo bez bodů" shows the parent); else null. Names come from `users.displayName`; nothing else of a user leaves the server.
- The same data for a taker and a giver: the family plans on one shared board (spec §5.12).

- [ ] **Step 1: Write the failing tests** in `weekPlan.test.ts`. Each one builds its week with `weekFamily()` and the real actions (`makeWeekCopies`, `reserveTask(…, true)`, `completeTask(…, true)`, `approveTask`, `cancelTask`, `createOnDemandInstance` with the switch on). Tests:
  - `no running period: empty table` → `toEqual({ period: null, today: <iso of Prague today 00:00>, days: [], rows: [] })`.
  - `columns: a week from Monday 00:00 to Sunday 20:00 has Mon..Sun` → `days` equals the 7 ISO day starts 30. 11. – 6. 12.
  - `eight columns after a Sunday 20:00 start when a Sunday copy is still open` → 8 days, the first is Sunday 29. 11.
  - `start day dropped when its only copy was done before the start` → completed at `startsAt − 1 ms`: 7 days. Boundary twin: completed exactly at `startsAt` → 8 days, and the copy is in the Sunday cell.
  - `start day dropped when its only copy expired before the start` → a Sunday deadline copy due 12:00 (+60 min) expires at 13:00, the period starts 20:00: 7 days. Boundary twin: `graceEndsAt` exactly at `startsAt` → 8 days, the expired copy in the Sunday cell.
  - `a period starting at Monday 00:00 keeps Monday with no Monday copy` → a chore with only a Tuesday slot: 7 days, Monday's cell is `[]`.
  - `a day starting exactly at the cutoff is not a column` (cutoff Monday 00:00) → the last column is Sunday.
  - `DST weeks: one column per Prague day across the clock change` → a period Sun 25. 10. 2026 20:00 – Sun 1. 11. 20:00 (autumn, change at 25. 10. 03:00) and its twin Sun 29. 3. 2026 20:00 – Sun 5. 4. 20:00 (spring): each has 8 distinct days, each `toPragueWallTime(…).hour === 0`, and a daily chore's copy lands in every column (no blank cell), which a fixed 24 h step would miss.
  - `rows: active templates with days only, in Czech title order` → a proposed template, an on-demand-only template and an active one with days: only the last has a row. Two active ones titled "Čistit boty" and "Zalít kytky" come out in that order. One agreed on Wednesday has blank cells (`[]`) before Wednesday.
  - `cells: every state` → one row, cells in this order: open (`person: null`), reserved by Mladší (`person: { id, name: 'Mladší' }`), done_unconfirmed by Starší, confirmed by Starší, expired (`person: null`), cancelled (`[]`).
  - `a done cell shows who did it, not who reserved it` → Mladší reserves, Táta marks it done without points: `person` is Táta.
  - `several copies on one day, oldest first` → a scheduled copy and an on-demand extra the same day: the cell has 2 copies in `createdAt` order, origins `['scheduled', 'on_demand']`.
  - `old-rule instances and self-logs are not copies` → an instance made with the switch off and a self-log on the same template: no copy in any cell.
  - `shape is pinned` → `expect(getWeekPlan(db, now)).toEqual({...})` with the full literal for a one-row week; `Object.keys` of a copy is exactly `['id', 'status', 'score', 'origin', 'createdAt', 'person']` and of `person` exactly `['id', 'name']` (no description, username or hash).
- [ ] **Step 2:** Run `pnpm test src/server/instances/weekPlan.test.ts`. Expected: FAIL, `getWeekPlan` is not exported.
- [ ] **Step 3: Implement `getWeekPlan`** in `src/server/instances/weekPlan.ts`, with the types above. Read the templates once and the copies once (`inArray(tasks.templateId, ids)`, `inArray(tasks.planDayAt, days)`, `inArray(tasks.status, PLAN_COPY_STATUSES)` with `PLAN_COPY_STATUSES` the five `PlanCopyStatus` values, so the type matches what the query returns). Group in memory. Names come from one `users` select. Do not add it to `./index.ts`: it is imported only by `./functions` (keeps the index for the scheduler's modules).
- [ ] **Step 4:** Run `pnpm test src/server/instances/weekPlan.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/server/instances/weekPlan.ts src/server/instances/weekPlan.test.ts && git commit -m "Read the week plan table: days of the running period, chores, copies"`

### Task 2: The server function, the demo piece and the seed

**Files:**
- Modify: `src/server/instances/functions.ts`, `tests/server-fn-guards.test.ts` (`getWeekPlanFn: 'giver,taker'`)
- Modify: `src/server/demo/pieces.ts`, `src/server/demo/seeds.ts`, `src/server/demo/suites.test.ts`, `src/server/demo/demo.test.ts`
- Test: `src/server/instances/weekPlan.test.ts` (handler cases)

**Interfaces:**
- Consumes: `getWeekPlan`, `WeekPlan` (Task 1); `getFlags` (`~/server/features`).
- Produces:
  - `export function weekPlanHandler(db: Db, now: Date): WeekPlan | { error: 'feature_off' }`
  - `export const getWeekPlanFn` (GET, `requireRole('giver', 'taker')`, handler `weekPlanHandler(getDb(), new Date())`)
  - `export type { WeekPlan, PlanRow, PlanCopy, PlanCopyStatus }` re-exported from `functions.ts` for the components
  - demo piece `planTable` and seed `plantable: { pieces: [planTable], features: ['recurring', 'week', 'weekPlan'] }`; `planTable` is appended last in `demo.pieces` (after `weekChores`, so earlier ids stay).

**Piece `planTable`.** Real actions in time order (the seed test checks audit order):
- **Chores.** Táta makes 4 chores and Starší agrees each one:
  - `Vyluxovat celý obývák a chodbu` (6, every day, no time, no deadline: the long name the 360 px rows need);
  - `Prostřít stůl k večeři` (2, every day);
  - `Zalít kytky na balkoně` (3, every day);
  - `Vynést koš na plasty` (4, Út + Pá 18:00, due the next day 7:00, +60 min: blank days).
- **No running period yet** (seed `plantable`): start one at **yesterday** 00:00 Prague (`rollPeriods(tx, yesterday, defaults)`). Agree the chores then, and make copies at that time (`makeWeekCopies(tx, yesterday, { templateId, log: SEED_LOG })`). Then:
  - yesterday 18:00: Starší completes yesterday's "Zalít kytky na balkoně" (`completeTask(…, true)`); Táta approves it at 19:00 → confirmed;
  - at `now`: `rollPeriods(tx, now, defaults)`, then `makeWeekCopies(tx, now, …)` for the 4 chores, so a Sunday cutoff yesterday still gives this week's copies;
  - yesterday's "Vyluxovat…" copy expires via `expireTask(tx, id, now, true)`.
- **A period already runs** (`demo`): agree at `now`, copies with `makeWeekCopies(tx, now, …)`, and nothing for yesterday.
- **Both cases, today's copies:** Mladší reserves "Vyluxovat…"; Starší completes "Zalít kytky na balkoně" (pending); "Prostřít stůl k večeři" stays free. If tomorrow has a copy, Starší reserves tomorrow's "Vyluxovat…".
- **No on-demand extra in the seed:** the switch is off while pieces run, so `createOnDemandInstance` would make an old-rule instance. The e2e makes the extra through Táta's "+ Teď" instead (Task 7).

- [ ] **Step 1: Write the failing tests.**
  - `weekPlan.test.ts` → `handler: switch off answers feature_off` (`toEqual({ error: 'feature_off' })`); `handler: switch on, taker and giver get the same table` (same `toEqual`; the function takes no viewer).
  - `tests/server-fn-guards.test.ts` → add `getWeekPlanFn: 'giver,taker'` (admin and anonymous refused by the guard scan).
  - `suites.test.ts` → `plantable (#258): today Mladší holds the long chore, Starší's flowers wait, the table is free` → seed at Prague Wed 2. 12. 10:00 and at Mon 30. 11. 10:00 (the Sunday-cutoff case). Check:
    - `getWeekPlan(db, now)` has the 4 rows in Czech order;
    - today's cells: Mladší reserved, Starší done_unconfirmed, open;
    - Wed case, yesterday's column: confirmed "Zalít kytky…", expired "Vyluxovat…";
    - Mon case: the running period starts Sun 20:00, so "Zalít kytky…" (completed Sun 18:00, before the start) belongs to the old week; the Sunday column holds only the expired "Vyluxovat…" (a no-deadline copy ends after its day, so it is still in the period);
    - switches exactly `recurring, week, weekPlan`;
    - audit `at` sorted.
  - `demo.test.ts` → the template count test becomes fifteen (#258 adds 4): update its title and numbers. Add `demo at T0: the plan table has the four #258 chores with today's reserved and pending copies`.
- [ ] **Step 2:** Run `pnpm test src/server/instances src/server/demo tests/server-fn-guards.test.ts`. Expected: FAIL (no handler, no seed).
- [ ] **Step 3: Implement** `weekPlanHandler` and `getWeekPlanFn` in `functions.ts`, then `planTable`, the seed `plantable` and the `demo` entry.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Serve the week plan table; demo chores for it"`

### Task 3: The cell rules (`planView.ts`) and the strings

**Files:**
- Create: `src/components/week/planView.ts`
- Modify: `src/lib/strings.ts` (`cs.plan`; `cs.templates.everyDay: 'každý den'`)
- Modify: `src/lib/templateText.ts` (new `export function describeDays(days: readonly number[]): string`: all 7 days → `'každý den'`, else the days Monday-first joined by `', '` with `WEEK_ORDER`; `describeTemplate` calls it, so Úkoly and the plan table say the same thing)
- Test: `src/components/week/planView.test.ts`, `src/lib/templateText.test.ts`

**Interfaces:**
- Consumes: `PlanCopy`, `PlanRow`, `WeekPlan` (Task 2 re-export); `dayLabel` (`~/components/tasks/taskView`: "Čt"), `dayMonth` (`~/components/period/periodView`), `formatPragueTime` (`~/lib/formatDate`), `formatPoints`, `cs`.
- Produces:

```ts
export type CellKind =
  | { kind: 'blank' }
  | { kind: 'free'; copy: PlanCopy }
  | { kind: 'reserved'; copy: PlanCopy; mine: boolean }
  | { kind: 'pending'; copy: PlanCopy }
  | { kind: 'confirmed'; copy: PlanCopy }
  | { kind: 'expired'; copy: PlanCopy }
  | { kind: 'count'; copies: PlanCopy[] }

export type Viewer = { id: number; role: 'taker' | 'giver' }
/** What a tap does: reserve, the Uvolnit sheet, release (list rows only), the list sheet, or the task page. */
export type TapAction = 'reserve' | 'releaseSheet' | 'release' | 'list' | 'open'

export function cellKind(copies: PlanCopy[], viewer: Viewer): CellKind
export function tapAction(cell: CellKind, viewer: Viewer): TapAction | null   // null for blank
export function listRowAction(copy: PlanCopy, viewer: Viewer): 'reserve' | 'release' | 'open'
export function isPast(day: string, today: string): boolean   // day < today
export function freeCount(plan: WeekPlan): number            // open copies on days >= today
export function dayHeader(day: string): { weekday: string; date: string }  // { 'St', '2. 12.' }
export function rowMeta(row: PlanRow): string                 // 'každý den' | 'Út, Pá', via describeDays
export function cellLabel(title: string, day: string, cell: CellKind, viewer: Viewer): string
export function listRowLabel(copy: PlanCopy, viewer: Viewer): { what: string; action: string | null }
```

**Strings** (`cs.plan`, exact copy):

| Key | Czech text |
| --- | --- |
| `title` | `'Plán týdne'` |
| `cardTaker` | `'Rozděl si úkoly na dny.'` |
| `cardGiver` | `'Kdo co dělá který den.'` |
| `freeCount` | `(n) => \`Volných: ${n}\`` |
| `turnHint` | `'Otoč telefon na šířku, uvidíš celý týden.'` |
| `scrollHint` | `'Dny posouváš do strany, názvy úkolů zůstávají vlevo.'` |
| `tapHint` | `'Klepni na volné políčko a je tvoje.'` |
| `everyDay` | `'každý den'` |
| `mine` | `'Moje'` |
| `pendingShort` | `'čeká'` |
| `expiredShort` | `'prošlo'` |
| `count` | `(n) => \`${n}×\`` |
| `reserved` | `(day) => \`Rezervováno: ${day}\`` |
| `reservedByYou` | `(points) => \`Rezervováno tebou · ${points}\`` |
| `reservedBy` | `(name) => \`rezervováno: ${name}\`` |
| `byYou` | `'rezervováno tebou'` |
| `bySchedule` | `'Podle rozvrhu'` |
| `extra` | `(time) => \`Navíc ${time}\`` |
| `close` | `'Zavřít'` |
| `openTask` | `'Otevřít úkol'` |
| `noRows` | `'Žádný opakovaný úkol nemá pevné dny.'` |
| `aria.free` | `'volné, rezervovat'` |
| `aria.mine` | `'rezervováno tebou, uvolnit'` |
| `aria.reserved` | `(name) => \`rezervováno, ${name}\`` |
| `aria.pending` | `(name) => \`čeká na potvrzení, ${name}\`` |
| `aria.confirmed` | `(name) => \`hotovo, ${name}\`` |
| `aria.expired` | `'prošlo'` |
| `aria.count` | `(n) => \`${n} kopie, otevřít seznam\`` |

- Reused strings, not new: Uvolnit, Rezervovat and Uvolněno (`cs.work.release`, `cs.work.reserve`, the existing released toast), the legend labels (`cs.state.open`, `.pending`, `.confirmed`, `.expired`), and `cs.week.noPeriod`.
- The aria label is `${title}, ${weekday}: ${state}`, e.g. `Prostřít stůl k večeři, St: volné, rezervovat`.

- [ ] **Step 1: Write the failing tests** in `planView.test.ts` (fixtures: `const ME = { id: 3, role: 'taker' }`, `BRO = 4`, `GIVER = { id: 2, role: 'giver' }`):
  - `cellKind` → `[]` blank; one open → free; reserved by 3 → `{ kind: 'reserved', mine: true }`, by 4 → `mine: false`, for a giver always `mine: false`; done_unconfirmed → pending; confirmed → confirmed; expired → expired; **boundary** 1 copy → its state, 2 copies → `{ kind: 'count', copies }`.
  - `tapAction` matrix:
    - taker on free → `'reserve'`, on his own reserved → `'releaseSheet'`;
    - taker on the brother's reserved, pending, confirmed, expired → `'open'`, on count → `'list'`;
    - giver on free and on reserved → `'open'` (never `'reserve'` or a sheet), on count → `'list'`;
    - blank → `null`.
  - `listRowAction` → taker open → `'reserve'`; taker own reserved → `'release'`; taker the brother's → `'open'`; giver on open → `'open'`.
  - `isPast` **boundary** → yesterday 00:00 vs today → true; today vs today → false; tomorrow → false.
  - `freeCount` → opens yesterday 1, today 2, tomorrow 1 (and one reserved today) → 3.
  - `dayHeader('<Wed 2. 12. 00:00 Prague ISO>')` → `{ weekday: 'St', date: '2. 12.' }`.
  - `rowMeta` → days `[0..6]` → `'každý den'`; `[2, 5]` → `'Út, Pá'` (it calls `describeDays`).
  - `templateText.test.ts` → `describeDays([0..6])` → `'každý den'`; `describeDays([5, 2])` → `'Út, Pá'`; the existing `describeTemplate` case `'Po, Út, St, Čt, Pá, So, Ne v 18:00 · do dalšího dne 7:00 (+2 h)'` becomes `'každý den v 18:00 · do dalšího dne 7:00 (+2 h)'` (one wording on Úkoly and in the table; Decisions 17).
  - `cellLabel` → free for a taker `'Prostřít stůl k večeři, St: volné, rezervovat'`; own `'…, St: rezervováno tebou, uvolnit'`; the brother's `'…, St: rezervováno, Mladší'`; count `'…, St: 2 kopie, otevřít seznam'`.
  - `listRowLabel` → a scheduled copy reserved by me `{ what: 'Podle rozvrhu · rezervováno tebou', action: 'Uvolnit' }`; an on-demand open copy made 14:20 `{ what: 'Navíc 14:20 · Volné', action: 'Rezervovat' }`; for a giver `action: null`.
- [ ] **Step 2:** Run `pnpm test src/components/week/planView.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `planView.ts` and `cs.plan`.
- [ ] **Step 4:** Run the same command and `pnpm test src/lib/strings.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Cell rules and Czech labels for the week plan table"`

### Task 4: The table component (reusable)

**Files:**
- Create: `src/components/week/WeekPlanTable.tsx`, `src/components/week/PlanSheets.tsx`
- Modify: `src/components/shell/Avatar.tsx` (`size?: 'sm' | 'md' | 'lg'`; `sm` = `size-[26px] text-sm`), `src/components/shell/Avatar.test.ts`
- Test: `src/components/week/weekPlanTable.test.tsx`, plus fixture `planFixture()` in `src/components/week/fixtures.ts`

**Interfaces:**
- Consumes: Task 3 exports; `useTaskAction` (`~/components/tasks/useTaskAction`); `reserveTaskFn`, `releaseTaskFn` (`~/server/tasks/functions`); `Drawer*` (`~/components/ui/drawer`); `Button`; `Avatar`; `EmptyState`; `Link` (`/ukol/$taskId`).
- Produces (for Task 5 and for #259):

```ts
/** Hook-free: everything a static test renders. `onTap` is called with the cell's action. */
export function WeekPlanTableView(props: {
  plan: WeekPlan
  viewer: Viewer
  busyId: number | null
  onTap: (action: TapAction, copies: PlanCopy[], row: PlanRow, day: string) => void
}): JSX.Element
/** The table with its sheets and actions: what /tyden/plan and #259's step 3 render. */
export function WeekPlanTable(props: { plan: WeekPlan; viewer: Viewer }): JSX.Element
export function ReleaseSheet(props: { open; onOpenChange; row: PlanRow; day: string; copy: PlanCopy; busy: boolean; onRelease: () => void }): JSX.Element
export function CopyListSheet(props: { open; onOpenChange; row: PlanRow; day: string; copies: PlanCopy[]; viewer: Viewer; busyId: number | null; onAction: (a: 'reserve' | 'release', copy: PlanCopy) => void }): JSX.Element
```

**Layout (wireframes 2 and 4):**
- **Card.** One `bg-surface rounded-card shadow-sticker` card holds two parts side by side:
  - Left: the pinned name column, `w-[120px]` in portrait and `landscape:w-[168px]`, **outside** the scroll area, with a right shadow edge.
  - Right: a `min-w-0 flex-1 overflow-x-auto` area with a grid of `days.length` columns:
    - portrait: `grid-template-columns: repeat(N, 64px)`, set by an inline `style` from N;
    - landscape: `repeat(N, minmax(44px, 1fr))` and no scroll.
- **Row height.** Every row has one fixed height on both sides: `h-[52px]`, and `landscape:h-[46px]`. The same class constant is used for the name cell and the day cell, so the two columns never drift apart.
- **Name cell.**
  - The title has `line-clamp-2 break-words`, 14 px, extra bold.
  - The meta line (`rowMeta`) has `truncate`, 11 px, muted.
  - At 360 px "Vyluxovat celý obývák a chodbu" wraps to two lines, and a longer name is cut after line 2 with an ellipsis. The full title stays in every cell's `aria-label`, on the task page and in the sheet titles (those wrap whole).
- **Header row.**
  - Each header shows `weekday` + `date`. The date is cut to the day number in portrait (`2.`), and the month is added in landscape (`2. 12.`) with a `portrait:hidden` span.
  - Today's header is a coral pill (`bg-accent-strong text-white`) with `aria-current="date"`.
  - Past days' headers are muted.
- **Cells.** Each cell is a `<button>` with `min-h-tap` and the full width of its column (≥ 44 px both ways in both orientations, see Review Focus 1), plus `data-day`, `data-today` and `data-past` attributes.
  - Free: `STATE_CHIP_BG.open`, a dashed `border-state-open` border, and a "+" in `STATE_TEXT.open`.
  - Mine: `STATE_CHIP_BG.reserved`, a solid border and an `Avatar size="sm"`.
  - The brother's: `bg-surface`, a `border-track` border and an avatar.
  - Pending: the points bar's diagonal pending stripes, an avatar and "čeká". Move PointsBar's `repeating-linear-gradient` class into one constant `PENDING_STRIPES` in `stateStyles.ts`; PointsBar and the cell both use it (no copy).
  - Confirmed: an avatar and "✓".
  - Expired: `STATE_CHIP_BG.expired` and "prošlo".
  - Count: `STATE_CHIP_BG.open` with a solid border and "2×".
  - Blank: a `<span>` of the row height, not a button.
  - Past days: `opacity-50` (the cell stays tappable: a deadline copy from yesterday can still be done in its grace window, so the server decides).
- **Under the card** (portrait only, `landscape:hidden`):
  - the turn hint, a `tint` box with a phone icon (lucide `Smartphone`), shown **above** the card;
  - the scroll hint, shown under the card;
  - the legend (Volné, Moje, Čeká na potvrzení, Hotovo, Prošlo), shown in both orientations.
  - Landscape (taker only): the tap hint, shown in the header line.
- **Busy.** With `busyId` set, every cell button is `disabled`. The busy cell has `aria-busy="true"` and a spinning `Loader2` with `motion-reduce:animate-none` in place of its content.
- **Empty states.** `plan.period === null` → `EmptyState` `cs.week.noPeriod`. `rows.length === 0` → `EmptyState` `cs.plan.noRows`.
- **Actions in `WeekPlanTable`.** `useTaskAction().run`:
  - `reserve` → `reserveTaskFn({ data: { taskId } })`, success toast `cs.plan.reserved(dayHeader(day).weekday)`;
  - `release` → `releaseTaskFn`, the existing Uvolněno toast;
  - a refusal → the hook's toast (`taskErrorMessage`, e.g. `wrong_state` → `cs.tasks.errors.gone`) and `router.invalidate()`, so the cell shows who got it, and the person can tap again;
  - a thrown network error → the hook's `cs.login.failed` toast.
  - `open` → `router.navigate({ to: '/ukol/$taskId', params })`.
  - `releaseSheet` / `list` → set the open sheet.
  - The sheet closes on success.
- **Sheets** (vaul `Drawer`, as the other sheets in the app use it; it keeps the existing look and its existing motion behaviour):
  - `ReleaseSheet`:
    - header: `Avatar` and the title `${row.title} · ${weekday} ${date}` (`break-words`), with `cs.plan.reservedByYou(formatPoints(score))` under it;
    - two `min-h-tap` buttons: Uvolnit (variant `no`, with a busy spinner) and Zavřít (variant `ghost`);
    - a link `cs.plan.openTask` to `/ukol/$taskId` (`min-h-tap`).
  - `CopyListSheet`: a row per copy (`min-h-tap`, the state stripe `STATE_STRIPE`, avatar or "+", `listRowLabel`):
    - a taker's reserve and release rows are buttons;
    - every other row, and every giver row, is a `Link` to the copy's page with a `ChevronRight`.
- No `Dialog`: reserving and releasing can both be undone, so nothing asks first.

- [ ] **Step 1: Write the failing tests** in `weekPlanTable.test.tsx` (`renderToStaticMarkup`, router and server fns mocked as in `tydenPage.test.tsx`):
  - `renders every cell kind with its aria label` → the fixture's labels from Task 3 appear. A blank day is no `<button>`.
  - `grid has one column per day` → with an 8-day fixture the inline style holds `repeat(8,`. The header has 8 cells.
  - `today's header is aria-current=date; past cells carry data-past and opacity-50`.
  - `long name: line-clamp-2 in the pinned column, full name in the aria label`.
  - `busy: every cell disabled, the busy one aria-busy` (`busyId` = a free copy's id).
  - `cells and sheet buttons are at least 44 px` → every `<button>` and sheet link has `min-h-tap` or `size-tap`.
  - `spinner has motion-reduce:animate-none`.
  - `no period → Týden ještě nezačal.`; `no rows → Žádný opakovaný úkol nemá pevné dny.`
  - `portrait hints are landscape:hidden; the tap hint shows for a taker only`.
  - `ReleaseSheet: Uvolnit, Zavřít and Otevřít úkol (href /ukol/<id>), title with the day` (rendered `open`).
  - `CopyListSheet: a taker gets Rezervovat / Uvolnit buttons; a giver gets links to each copy`.
  - `Avatar.test.ts` → `size sm has size-[26px]`.
- [ ] **Step 2:** Run `pnpm test src/components/week src/components/shell`. Expected: FAIL.
- [ ] **Step 3: Implement** the components and `Avatar` `sm`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Week plan table component with its Uvolnit and list sheets"`

### Task 5: The route `/tyden/plan`

**Files:**
- Create: `src/routes/_app/tyden/plan.tsx`
- Modify: `src/lib/nav.ts`, `src/lib/nav.test.ts`, `src/routeTree.gen.ts` (generated)
- Test: `src/components/week/planPage.test.tsx`

**Interfaces:**
- Consumes: `WeekPlanTable` (Task 4), `getWeekPlanFn` (Task 2), `guardScreen`, `Screen`.
- Produces: the path `'/tyden/plan'` (Task 6 links to it).

**The route:**
- `beforeLoad`:
  - `guardScreen(context.user.role, '/tyden/plan')`;
  - if `!context.features.weekPlan`, throw `redirect({ to: '/tyden' })`.
- `loader: () => getWeekPlanFn()`.
- The component renders `<Screen title={cs.plan.title} user={user} back="/tyden">`, with the period's `weekLabel(startsAt, cutoffAt)` as a muted Fredoka line under the title.
- Then `<WeekPlanTable plan viewer={{ id: user.id, role }} />`.
- An `{ error }` answer (the switch was turned off between beforeLoad and loader) renders the `cs.tasks.errors.notAllowed` card, as `pristi.tsx` does.
- A loader failure goes to the app's `defaultErrorComponent` (`RouteError`: Czech message and retry).

- [ ] **Step 1: Write the failing tests:**
  - `nav.test.ts` → `/tyden/plan` is `['taker', 'giver']`, and the admin is sent to `/sprava`;
  - `planPage.test.tsx`:
    - `loader calls getWeekPlanFn`;
    - `beforeLoad redirects to /tyden with weekPlan off`;
    - `title Plán týdne, back to /tyden, the week's dates`;
    - `feature_off answer shows the not-allowed card`.
  - `tests/screen-guards.test.ts` picks the file up by itself.
- [ ] **Step 2:** Run `pnpm test src/lib/nav.test.ts src/components/week/planPage.test.tsx tests/screen-guards.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the route and the nav entry. Run `pnpm build` to regenerate `src/routeTree.gen.ts`.
- [ ] **Step 4:** Run the same tests and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Plán týdne screen at /tyden/plan"`

### Task 6: The entry card on Týden

**Files:**
- Modify: `src/routes/_app/tyden/index.tsx`, `src/components/week/WeekScreen.tsx`
- Test: `src/components/week/tydenPage.test.tsx`, `src/components/week/week.test.tsx`

**Interfaces:**
- Consumes: `getWeekPlanFn`, `freeCount` (Task 3).
- Produces: `export function PlanCard(props: { free: number; viewerRole: 'taker' | 'giver' })` in `WeekScreen.tsx`; `WeekScreen` gets an optional `plan?: { free: number }`.

**The card** (wireframe 1, placed **above** the Tento týden / Historie tabs):
- a `Link` to `/tyden/plan`, `min-h-tap`, `rounded-card bg-surface shadow-sticker`;
- a 44 px tinted icon box (lucide `CalendarDays`, `text-accent-strong`);
- the title `cs.plan.title`, `font-display`;
- the line `${cardTaker|cardGiver} ${freeCount(n)}`, muted 13 px, wrapping;
- a `ChevronRight`.

**The loader:** `plan: context.features.weekPlan ? await getWeekPlanFn() : null`. The card shows only for a `WeekPlan` answer (not `null`, not `{ error }`).

- [ ] **Step 1: Write the failing tests:**
  - `tydenPage.test.tsx` → `weekPlan off: no card and no getWeekPlanFn call`; `weekPlan on: the card links to /tyden/plan with "Volných: 3" (taker line) and sits before the tabs`; `giver line Kdo co dělá který den.`
  - `week.test.tsx` → `PlanCard has min-h-tap and the chevron`.
- [ ] **Step 2:** Run `pnpm test src/components/week`. Expected: FAIL.
- [ ] **Step 3: Implement** the card and the loader.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Plán týdne card on Týden"`

### Task 7: The e2e suite and the screenshots

**Files:**
- Create: `e2e/week-plan.spec.ts`
- Modify: `e2e/suites.ts` (row `{ name: 'week-plan', spec: 'week-plan.spec.ts', seed: 'plantable' }`, with the comment "Its own server: it reserves, releases and adds an extra copy for good."), `tests/e2e-suites.test.ts` if it lists rows.

**Interfaces:**
- Consumes: the seed `plantable` (Task 2), `passwordLogin` (`e2e/helpers.ts`), `cs`.

**Locating cells.** Locate cells by role and name inside today's column: `page.locator('[data-today]').getByRole('button', { name: /^Prostřít stůl k večeři, .*: volné/ })`. Never assume a weekday. Later-day checks run only when such a column exists (`[data-day]` after `[data-today]`). The spec runs serially (`test.describe.configure({ mode: 'serial' })`), in the order below.

- [ ] **Step 1: Write the tests:**
  - `Starší, portrait 393×852: Týden card → table; tap a free cell reserves it, tap again offers Uvolnit, Uvolnit frees it`:
    - the card shows `Volných:`, and clicking it lands on `/tyden/plan`;
    - the turn hint is visible;
    - tap today's free "Prostřít stůl k večeři" → toast `Rezervováno: <weekday>`, and the cell's label becomes `…: rezervováno tebou, uvolnit`;
    - tap it → a dialog with `Uvolnit` and `Zavřít`; tap `Uvolnit` → the label is back to `…: volné, rezervovat`.
  - `Starší: Mladší's reserved cell opens its task page` → tap today's "Vyluxovat…" (`rezervováno, Mladší`) → URL `/ukol/\d+`.
  - `a stale free cell says someone was faster and shows his avatar`:
    - Starší has the table open;
    - in a second browser context Mladší reserves today's "Prostřít stůl k večeři" from his table;
    - Starší taps the same cell → toast `cs.tasks.errors.gone`, and the cell shows `rezervováno, Mladší`.
    - Afterwards Mladší releases it (sheet → Uvolnit), so the next test has a free cell.
  - `landscape 852×393: every day fits without sideways scroll, no turn hint`:
    - for the days scroller, `scrollWidth <= clientWidth`;
    - the turn hint is hidden;
    - every `[data-day]` header is in the viewport.
  - `Táta: a free cell opens its page; + Teď makes a second copy, the count opens the list`:
    - Táta taps today's free "Prostřít stůl k večeři" → `/ukol/\d+`, and nothing is reserved;
    - on Úkoly he taps "+ Teď" for "Prostřít stůl k večeři";
    - back on the table, today's cell reads `…: 2 kopie, otevřít seznam`;
    - tapping it opens the list with 2 rows, and a row is a link to `/ukol/\d+`.
  - `Starší: the list reserves and releases the extra copy` → open the `2×` cell → tap `Rezervovat` on the `Navíc …` row → toast, and the row reads `… · rezervováno tebou`; then tap `Uvolnit` on that row → toast, and the row reads free again (`Rezervovat` is back). Asserts the release path calls `releaseTaskFn`.
  - `busy: while a reserve is in flight every cell is disabled and the tapped one is aria-busy` → hold the reserve request with `page.route`, assert `disabled` on cells and `aria-busy="true"` on the tapped one, then release the request (the same run takes the busy screenshot).
  - `360×800: the long name wraps in the pinned column` → the "Vyluxovat celý obývák a chodbu" name cell has `scrollWidth <= clientWidth` (nothing overflows sideways), and its box height ≤ the row height.
- [ ] **Step 2:** Run `pnpm build && pnpm exec playwright test e2e/week-plan.spec.ts`. Expected: PASS. Fix the code, not the test, on a failure (`superpowers:systematic-debugging`).
- [ ] **Step 3: Screenshots** (`pr-brief` and `pr-review-rounds` §1 code phase: one Playwright run, iPhone 15 Pro, `deviceScaleFactor: 3`, light, one screen per file, a folder outside the repo, `plantable` seed):
  - `tyden-taker-card.png`, `tyden-giver-card.png`;
  - `plan-taker-portrait.png`, `plan-taker-portrait-scrolled.png` (days scrolled to the end);
  - `plan-taker-landscape.png` (852×393), `plan-giver-landscape.png`;
  - `plan-taker-release-sheet.png`, `plan-taker-count-sheet.png`, `plan-giver-count-sheet.png`;
  - `plan-taker-busy.png` (request held with `page.route`), `plan-taker-error-toast.png` (stale tap);
  - `plan-taker-empty.png` (a seed with no period: the `family` seed with weekPlan on, through a one-off server);
  - `plan-taker-portrait-360.png` (360×800, long name);
  - one dark-theme file, `plan-taker-landscape-dark.png`.
  There are no keyboard files: the screen has no text field.
- [ ] **Step 4:** Run `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test && pnpm db:check`. Expected: all pass.
- [ ] **Step 5: Commit** `git commit -m "e2e: week plan table, portrait and landscape"`

---

## Pre-flight coverage (pr-review-rounds §1)

**Tests pre-flight:**
- **Audit rollback.** This PR adds no state change: reserve and release are `reserveTask` / `releaseTask` from #257, whose rollback tests stand. The demo piece writes through the real actions, and the seed's own transaction tests cover it.
- **Boundaries** (Task 1, Task 3):
  - start-day copy done at `startsAt − 1 ms` vs at `startsAt`;
  - a day starting exactly at the cutoff;
  - a period starting at 00:00 vs not;
  - `isPast` at today's 00:00;
  - 1 vs 2 copies → count;
  - `freeCount` at today vs yesterday;
  - the DST week.
- **Wrong actor:**
  - the admin is refused by `getWeekPlanFn`'s guard (`tests/server-fn-guards.test.ts`) and by the screen guard (`nav.test.ts`, Task 5);
  - a giver's tap never reserves (`tapAction`, Task 3; e2e Task 7);
  - a taker on the brother's reserved cell gets the page, not Uvolnit (Task 3; e2e);
  - with the switch off, the handler returns `feature_off` (Task 2) and the route redirects (Task 5).
- **Real entry point:** `/tyden/plan` and `getWeekPlanFn` run in e2e (Task 7); the `planTable` piece runs through `seedDemo` (Task 2).
- **Shape pinned:** the `toEqual` and the key lists in Task 1; the handler's `{ error: 'feature_off' }` in Task 2.

**UX pre-flight:**
- **44 px:**
  - cells are `min-h-tap` and at least 64 × 52 in portrait; in landscape they are `minmax(44px, 1fr)` × 46 (plus `min-h-tap`);
  - the sheet buttons, the list rows, the card and the back button are `min-h-tap` / `size-tap` (Task 4 test).
- **motion-reduce:** the busy spinner has `motion-reduce:animate-none` (Task 4 test). The sheets use the app's existing `Drawer` unchanged. If its open animation has no reduced-motion opt-out, that is pre-existing → a `follow-up` issue, not a fix here.
- **Busy and errors:**
  - every request (reserve, release) disables all cells, shows a spinner on the tapped one and `aria-busy`;
  - a refusal shows a Czech toast (`taskErrorMessage`) and reloads; a network error shows `cs.login.failed`;
  - tapping again retries (Task 4, e2e stale test).
- **Empty and error states:** no period → `cs.week.noPeriod`; no chores with days → `cs.plan.noRows`; a loader failure → `RouteError`; the switch off mid-load → the not-allowed card (Tasks 4, 5).
- **Cannot undo:** nothing. Reserve and release are both undoable, so there is no Dialog.
- **Long Czech name at 360 px:**
  - the pinned name wraps to 2 lines (`line-clamp-2 break-words`), and anything longer is cut after line 2 with an ellipsis;
  - the schedule line is cut (`truncate`);
  - cells never shrink below 64 px (they scroll instead);
  - the sheet titles and list rows wrap whole;
  - the full name is always in the cell's `aria-label` and on the task page (Task 4 test, e2e 360 test, `plan-taker-portrait-360.png`).

## Decisions this plan makes (not fixed by the spec, issue or wireframes)

All of them go into the PR brief.

1. Route `/tyden/plan`, like `/tyden/pristi`.
2. The card sits above the Tento týden / Historie tabs (as on board 1). Its line is the role's hint plus `Volných: N`, where N = open copies from today on.
3. Rows are sorted by title (Czech collation).
4. A cancelled copy is left out; a day whose only copy was cancelled is blank.
5. The start-day rule: a start-day copy completed before the period's start is the old week's. The start column shows only if a start-day copy is left, and always when the period starts at midnight.
6. The columns run up to the cutoff. A Sunday 20:00 start can give 8 columns, and the grid sizes to `days.length`.
7. Past-day cells stay tappable, by the same tap rules (the server decides). This matters for a deadline copy still in its grace window.
8. Done and confirmed cells show who did it (`completedBy`), a parent too. Expired cells show no avatar.
9. A row's meta line shows only the days (`každý den` / `Út, Pá`), not the time or the deadline.
10. Day headers read `St 2.` in portrait and `St 2. 12.` in landscape.
11. In the several-copies sheet, a taker's free row reserves and his own row releases, straight away with no second sheet. Every other row, and every giver row, opens the task page (board 5 shows Rezervovat / Uvolnit on the rows).
12. List rows say `Podle rozvrhu` for a scheduled copy and `Navíc HH:MM` for a parent's extra.
13. The count cell is always the blue "N×" (board 5), whatever states its copies are in.
14. The e2e makes the on-demand extra through Táta's "+ Teď". The seed cannot: the switch is off while the seed's pieces run.
15. The data is the same for a taker and a giver (the whole family's board); only the taps differ.
16. `Avatar` gets a `sm` size (26 px) for cells.
17. An every-day chore reads "každý den" on Úkoly too (shared `describeDays`, Architecture judge round 1), instead of listing all seven days.
18. A start-day copy that expired before the period started (its grace ended before `startsAt`) belongs to the old week, like one completed before the start (Rules judge round 1).
