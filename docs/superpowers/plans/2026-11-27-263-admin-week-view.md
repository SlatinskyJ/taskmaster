# Admin opens a disputed week from Sporné: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#263 Let the admin open a disputed week from Sporné](https://github.com/SlatinskyJ/taskmaster/issues/263)

**Goal:** On Správa → Sporné, a settlement card and an adjustment card open a read-only view of that brother's week for the admin: the level, the deduction and the carry-over (once settled), and the tasks, chores and adjustments behind the total.

**Architecture:** One new read in `src/server/settlement/adminWeek.ts` (`getAdminWeek(db, periodId, takerId)`), reusing Týden's history helpers from `week.ts`. One admin-only live server function. The dispute target gains a `week` link (period + taker) beside its existing `page`. A new admin route `/sprava/tyden/$periodId/$takerId` renders a pure component built from Týden's existing row pieces (`TaskRow`, `adjustmentRow`, `historyLine`, `correctionLine`). No schema, no migration, no state change, no audit entry.

**Tech Stack:** TanStack Start + Router (file routes), Drizzle/SQLite, React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.5 (a completion belongs to the period of its `completed_at`), §5.7, §5.8 (period end), §5.9 (settlement record, correction, adjustments), §5.11 (disputable: the settlement record and a manual adjustment). UI doc §7.5 (Správa, ADisputes). Decisions on the issue:
- Jakub 2026-11-26: a settlement or adjustment card on Sporné links to a read-only view of that brother's settled week for the admin: the level, the deduction, and the tasks and chores behind the total (what the brother sees on Týden). An adjustment card links to the week it counts in.
- Jakub 2026-11-27 (decision card): an adjustment whose week is not settled yet opens the same view of the week so far, with a line that the week is not settled yet (no level).

**Size:** about 380 changed lines outside tests (server ~150, route ~60, screen component ~110, strings/nav/card/targets ~60). One PR: every part is needed before anything is visible.

## Global Constraints

- UI labels in Czech, only in `src/lib/strings.ts`; code and identifiers in English.
- Prague wall-clock maths only through `src/domain/dates.ts`; all stored times are UTC ISO (`toIsoUtc`).
- The view exists only while the `disputes` launch switch is on (Sporné itself is hidden when off). Off: the server function answers `{ error: 'feature_off' }`, the route sends the admin back to `/sprava`.
- Admin only (`requireRole('admin')`). The admin is not a party: no Rozporovat, no dispute marks on this view.
- A period's span is `[startsAt, periodEnd(p))` (`periodEnd` = `endedAt ?? cutoffAt`), start inclusive, end exclusive, compared as UTC ISO strings, the same as `week.ts` history.
- Every tap target ≥ 44 px (`min-h-tap`), long Czech names wrap (`break-words`), never cut.

## Review Focus

1. A completion done exactly at the week's start counts in this week; one done exactly at its end counts in the next (task 1 boundary tests).
2. An adjustment made exactly at a week's end links to the next week, not this one (task 2 boundary test).
3. A brother's week never shows his brother's tasks or adjustments (task 1 "only this taker" test).
4. A corrected settlement shows the corrected level first and the correction line, like Týden (task 1 + task 4 tests).
5. A URL with a period or user that does not exist, or a non-number, shows Nenalezeno, not a crash (task 3 + task 5 tests).

---

### Task 1: `getAdminWeek` read

**Files:**
- Create: `src/server/settlement/adminWeek.ts`
- Modify: `src/server/settlement/week.ts`: extract `export function historyRecords(db, rows, names, spans, adjusted, marks?): HistoryRecord[]` (the record-building body of `history()`, which then calls it; with no `marks` every `dispute` is `null`) and export `periodSpans`, `adjustmentsOf` and the `Span`/`Adjusted` types. No behaviour change: Týden's tests stay green unchanged.
- Test: `src/server/settlement/adminWeek.test.ts`

**Interfaces:**
- Produces:

```ts
export interface AdminWeekItem {
  taskId: number
  title: string
  score: number
  status: 'confirmed' | 'done_unconfirmed'
  /** UTC ISO completed_at. */
  at: string
}
export interface AdminWeek {
  taker: { id: number; name: string }
  week: { periodId: number; startsAt: string; endsAt: string; levels: Levels }
  /** His settlement record of this week, as Týden's Historie shows it; null: not settled yet. */
  record: HistoryRecord | null
  /** The carry-over of his latest settlement of an earlier week, else 0. */
  carriedIn: number
  /** His completions with completed_at in the week (confirmed, and still waiting), newest first. */
  items: AdminWeekItem[]
  /** His adjustments made in the week, oldest first (`waiting: false`). */
  adjustments: WeekAdjustment[]
}
export function getAdminWeek(db: Db | Tx, periodId: number, takerId: number): AdminWeek | null
```

`record.dispute` is always `null` and `record.adjustments` equals `adjustments` (the admin gets no marks). Returns `null` when the period or the user does not exist.

- [ ] **Step 1: Write the failing tests** in `adminWeek.test.ts` (fixtures from `~/server/settlement/testing` / `~/server/tasks/testing`, `createTestDb()`):
  - `settled week: the record, carry-in from his earlier settlement, his tasks and adjustments` — two settled weeks for Starší; `getAdminWeek(db, week2, starsi)` → `record` has `totalBefore`, `level`, `deducted`, `carryOver` of week 2's settlement; `carriedIn` = week 1's `carryOver`; `items` = his confirmed completions of week 2 newest first; `adjustments` = the adjustment made in week 2.
  - `boundaries: completed at the start counts, at the end does not` — completions at exactly `startsAt` (in) and exactly `endsAt` (out, it is in the next week); same for an adjustment's `madeAt`.
  - `only this taker` — both brothers settled in weeks 1 and 2 with different totals, levels and carry-overs, each with a completion and an adjustment in week 2: Starší's view of week 2 has Starší's record (`record.takerId`, `totalBefore`, `level`, `carryOver`), Starší's week-1 carry-over as `carriedIn`, and none of Mladší's items or adjustments; and the same the other way round.
  - `carriedIn of an older week` — weeks 1, 2, 3 settled for Starší: the view of week 2 has week 1's `carryOver` (not week 3's), the view of week 1 has 0.
  - `only confirmed and waiting completions` — a rejected, a cancelled and an open task of his in the week are absent; a `done_unconfirmed` one is present with its status.
  - `corrected settlement` — after a correction, `record.correction` holds the corrected level and deduction; the correction's adjustment (made in a later week) appears in that later week's `adjustments` with `fromWeek` set, not in the corrected week.
  - `running week: record null` — the current period, Starší with a completion and an adjustment: `record === null`, items and adjustments listed, `carriedIn` from his latest settlement.
  - `first week: carriedIn 0`.
  - `unknown period or user → null`.
  - `shape` — `Object.keys` of the result and of `taker` pinned exactly (`['taker','week','record','carriedIn','items','adjustments']`, `['id','name']`): no other user fields.
- [ ] **Step 2: Run** `pnpm test src/server/settlement/adminWeek.test.ts` — expected FAIL (module missing).
- [ ] **Step 3: Implement** `getAdminWeek` in `adminWeek.ts`. Period by id via `listPeriods`/`toPeriod`; span from `periodSpans`; name from `users.displayName`. Items: `tasks` where `earnerId = takerId`, status in `confirmed`/`done_unconfirmed`, `completedAt >= startsAt and < endsAt`, sorted `at` desc then `taskId` desc. Adjustments: `adjustmentsOf(db, [takerId], spans)` filtered to the span, `waiting: false`. Record: his settlement with `periodId`, through `historyRecords` (no marks). `carriedIn`: `carryOver` of his settlement whose period starts latest before this period's start, else 0.
- [ ] **Step 4: Run** the test file and `pnpm test src/server/settlement` (Týden unchanged) — PASS.
- [ ] **Step 5: Commit** `Admin week read for a brother's week (#263)`.

### Task 2: dispute target names its week

**Files:**
- Modify: `src/server/disputes/targets.ts`, `src/server/disputes/list.ts`
- Test: `src/server/disputes/targets.test.ts` (create if missing, else add), `src/server/disputes/list.test.ts` (or the existing admin list test)

**Interfaces:**
- Produces: `export interface WeekPage { periodId: number; takerId: number }` (in `list.ts`); `AdminDisputeEntry.weekPage: WeekPage | null`. `loadTarget` and `ItemPage` are **not** changed: many paths call `loadTarget`, and `mapping.ts` turns `page` into a live topic (`task:`/`template:`), which a week is not.

- [ ] **Step 1: Failing tests:**
  All through `listOpenForAdmin(db)` (open disputes on each item):
  - `a settlement names its week` — the entry's `weekPage` = `{ periodId: s.periodId, takerId: s.takerId }`.
  - `an adjustment names the week it was made in` — made inside the running period → that period; made inside a settled one → that one.
  - `an adjustment made exactly at a week's end names the next week` — `madeAt === periodEnd(p1)` → p2.
  - `an adjustment outside every period names none` — before the first period → `null`.
  - `other kinds have none` — task_score, completion, template_score, rejection → `null`.
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3: Implement** `weekPageOf(db, item, takerId): WeekPage | null` in `list.ts`, called only from `listOpenForAdmin`: settlement → its row's `periodId` and `takerId`; adjustment → `periodAtInstant(db, new Date(madeAt))` (`~/server/periods`, the §5.5 rule), its id, else null; every other kind null. `DisputeListEntry` for parties is unchanged.
- [ ] **Step 4: Run** `pnpm test src/server/disputes src/server/live` — PASS (mapping untouched).
- [ ] **Step 5: Commit** `Sporné entries name a settlement's or adjustment's week (#263)`.

### Task 3: admin server function and live topics

**Files:**
- Modify: `src/server/settlement/functions.ts`, `src/server/live/README.md` (topics table row), `src/server/live/screens.test.ts` (registry row for the new screen)
- Test: `src/server/settlement/functions.test.ts`

**Interfaces:**
- Consumes: `getAdminWeek` (task 1).
- Produces:

```ts
export function parseAdminWeek(data: unknown): { periodId: number; takerId: number } // positive safe ints, else throws 'Invalid input'
export function adminWeekHandler(db: Db, arg: { periodId: number; takerId: number }): AdminWeek | null | { error: 'feature_off' }
export const adminWeekRead // liveRead; topics: feature_off or null → []; else ['week', 'people', idTopic('points', takerId)]
export const getAdminWeekFn // GET, requireRole('admin'), validator parseAdminWeek, serveLive(adminWeekRead, ...)
export type { AdminWeek, AdminWeekItem }
```

- [ ] **Step 1: Failing tests:** `adminWeekHandler` → `{ error: 'feature_off' }` with `disputes` off; the week with it on; `null` for an unknown period. `parseAdminWeek` refuses `0`, `-1`, `1.5`, `'3'`, missing keys. `adminWeekRead.topics` = `['week','people','points:<takerId>']`, and `[]` for off/null. Wrong actor: the server function's guard is pinned in task 6's e2e (a brother and a parent replay the admin's real request and are refused).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** in `functions.ts` (`getFlags(db).disputes` gate first). Add the README row: `getAdminWeekFn` (off → none) | - | - | `week`, `people`, `points:<taker>`. Add the screen to `screens.test.ts`'s registry so the "every loader's calls have a row" check passes and the admin's union stays under `TOPIC_LIMIT`.
- [ ] **Step 4: Run** `pnpm test src/server/settlement src/server/live` — PASS.
- [ ] **Step 5: Commit** `Admin week server function (#263)`.

### Task 4: the week screen component and strings

**Files:**
- Create: `src/components/admin/AdminWeekScreen.tsx`
- Modify: `src/lib/strings.ts` (`cs.admin.week`)
- Test: `src/components/admin/adminWeek.test.tsx` (static markup, `renderToStaticMarkup`, router `Link` mocked as in `disputesCard.test.tsx`)

**Interfaces:**
- Consumes: `AdminWeek` (task 1); `historyLine`, `correctionLine`, `adjustmentRow` (`~/components/week/weekView`); `levelBadgeClass`, `levelLabel`, `weekLabel` (`~/components/period/periodView`); `TaskRow`, `taskLink`, `SectionLabel`, `EmptyState`.
- Produces: `export function AdminWeekScreen({ week }: { week: AdminWeek })`.

Czech copy (exact):

```ts
week: {
  /** The screen title: whose week it is. */
  title: (name: string) => `Týden: ${name}`,
  /** The week not settled yet (Jakub 2026-11-27): no level. */
  notSettled: 'Týden ještě není vyúčtovaný.',
},
```

Two more, since Týden's `happened`/`noItems` say "this week" and "zatím", wrong for a past week:

```ts
  happened: 'Co se v týdnu stalo',
  noItems: 'V týdnu nic hotového.',
```

Reused as on Týden: `cs.week.carried(...)` (carry-in), `cs.meeting.levelsLabel`.

Layout, top to bottom, inside one `rounded-card bg-surface p-4 shadow-sticker` card like Týden's history card: the week label and levels (`weekLabel · Hranice lower / upper`); settled: the level badge (corrected level when corrected), `historyLine(record)`, `correctionLine(record)` when corrected; unsettled: `notSettled` in `text-meta font-bold text-state-pending-text`; then `cs.week.carried(carriedIn)`. Below the card, section `cs.admin.week.happened`: adjustments first (`adjustmentRow` → `TaskRow`, no footer), then items (`TaskRow`, chip `confirmed`/`pending`, points = score, meta = `dayLabel(at)`, `link={taskLink(taskId)}`: the admin may open a task page while `disputes` is on, #222). No items and no adjustments → `EmptyState` with `cs.admin.week.noItems`.

- [ ] **Step 1: Failing tests:** settled week renders the level label, the history line text and both rows; corrected week renders the corrected level badge and the correction line; unsettled week renders `notSettled` and no level badge; empty week renders `cs.admin.week.noItems`; a task row links to `/ukol/<id>`; a long name (`Vyluxovat celý obývák a chodbu`) is in the markup whole with `break-words` on its container; no `Rozporovat` text anywhere.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the component and the strings.
- [ ] **Step 4: Run** `pnpm test src/components/admin src/lib/strings.test.ts` — PASS.
- [ ] **Step 5: Commit** `Admin week screen (#263)`.

### Task 5: route, nav, and the Sporné card link

**Files:**
- Create: `src/routes/_app/sprava_/tyden/$periodId/$takerId.tsx` (folder routes like the rest; path `/sprava/tyden/$periodId/$takerId`, not nested in Správa's component; `src/routeTree.gen.ts` regenerated by `pnpm build`/`dev` and committed)
- Modify: `src/lib/screenGuard.ts`, `src/lib/screenGuard.test.ts`, `src/lib/nav.ts` (`APP_PATHS` + `SCREEN_ROLES['/sprava/tyden/$periodId/$takerId'] = ['admin']`), `src/lib/nav.test.ts`, `src/components/admin/DisputesCard.tsx`, `src/components/admin/disputesCard.test.tsx`

**Interfaces:**
- Consumes: `getAdminWeekFn` (task 3), `AdminWeekScreen` (task 4), `AdminDisputeEntry.weekPage` (task 2).

Route: `beforeLoad` → new `guardAdminWeek(role: Role, disputesOn: boolean): void` in `screenGuard.ts`: `guardScreen(role, '/sprava/tyden/$periodId/$takerId')` (others go to their landing), then with the switch off `throw redirect({ to: '/sprava' })`. Loader: `parseIdParam` both params, `null` → `notFound()`; `live.take(await getAdminWeekFn({ data }))`; `null` or `feature_off` → `notFound()`. Screen: `<Screen title={cs.admin.week.title(week.taker.name)} back="/sprava" user={user}>`; loader errors fall to the app's existing `RouteError` (Czech message + Zkusit znovu), not-found to `NotFound`. `live: live.all()` returned like every other loader.

DisputesCard: the stretched link goes to the week when `e.weekPage` is set (`to: '/sprava/tyden/$periodId/$takerId'`, params as strings), with the same `aria-label={t.openFor(cs.disputes.what[e.item.kind], l.name)}` and the same `relative`/`z-10` handling as a page link, so Ponechat and Opravit never open it. Entries with neither `page` nor `weekPage` stay unlinked.

- [ ] **Step 1: Failing tests:** `screenGuard.test.ts`: `guardAdminWeek('admin', true)` passes; `('admin', false)` throws a redirect to `/sprava`; `('taker', true)` and `('giver', true)` throw a redirect to `/`. `nav.test.ts` matrix row `'/sprava/tyden/$periodId/$takerId': 'admin'`; `disputesCard.test.tsx`: a settlement entry with `weekPage {periodId: 4, takerId: 2}` renders `href="/sprava/tyden/4/2"` with the `openFor` label; an adjustment entry likewise; an entry with no `page`/`weekPage` has no `<a>`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** route, nav, card; run `pnpm build` to regenerate `routeTree.gen.ts`.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm lint && pnpm test` — PASS.
- [ ] **Step 5: Commit** `Open a disputed week from Sporné (#263)`.

### Task 6: e2e through the real route

**Files:**
- Create: `e2e/admin-week.spec.ts`
- Modify: `e2e/suites.ts` (row `{ name: 'admin-week', spec: 'admin-week.spec.ts', seed: 'corrections' }`, read-only)

The `corrections` seed already has an open dispute on Mladší's corrected settlement and on Starší's +5 manual adjustment (`src/server/demo/pieces.ts`), so no new demo piece is needed.

- [ ] **Step 1: Write the tests:**
  - `the admin opens a disputed settlement: its level, correction and tasks` — log in `admin`, Správa, click the link named `openFor(what.settlement, <week label>)` on Mladší's card; URL matches `/sprava/tyden/\d+/\d+`; title `Týden: Mladší`; the corrected level label and the correction line are visible; at least one task row is visible; no `Rozporovat` button; back goes to `/sprava`.
  - `the admin opens a disputed adjustment: the week it counts in` — Starší's adjustment card → his week; the adjustment row (`Úprava bodů`, `+5`) is visible; `Týden ještě není vyúčtovaný.` is visible (the seed makes the adjustment now, in the running week).
  - `a brother cannot open it` — log in `starsi`, `goto('/sprava/tyden/1/2')` → lands on his landing page (`/`).
  - `the server function refuses a brother and a parent` — while the admin opens the view, record the `getAdminWeekFn` request (`page.waitForRequest` on the server-function URL: method, URL, body); then in fresh contexts logged in as `starsi` and as `tata`, replay it with `context.request.fetch(url, { method, headers, data })` and assert the response is not 2xx and its body has neither `Mladší` nor `totalBefore`.
  - `unknown week → Nenalezeno` — admin `goto('/sprava/tyden/9999/2')` shows the not-found screen.
- [ ] **Step 2: Run** `pnpm exec playwright test e2e/admin-week.spec.ts --trace off` (through the suite runner as the other suites) — PASS.
- [ ] **Step 3: Commit** `E2e: the admin opens a disputed week (#263)`.

## Not in this PR

- No view for an adjustment outside every period (the card stays unlinked).
- No link from Opravy bodů or anywhere else; only the Sporné cards.
- Týden for brothers and parents is unchanged.
