# Week plan at Schůzka Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (CLAUDE.md PR flow step 3). Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#259 Show the week plan at Schůzka](https://github.com/SlatinskyJ/taskmaster/issues/259), depends on [#258](https://github.com/SlatinskyJ/taskmaster/issues/258) (merged as PR #297).

**Goal:** With the `weekPlan` switch on, Schůzka step 3 (Plan) shows #258's plan table, giver view, under the open one-time tasks, on the Prague day of the latest settlement. An "Obnovit" button refetches the table.

**Architecture:**
- The meeting read gets one boolean, `settledToday`: whether the latest settlement was confirmed on today's Prague date. Day maths go through `src/domain/dates.ts`'s `pragueDaysBetween`.
- The Schůzka loader fetches #258's `getWeekPlanFn` only when the switch is on and `settledToday` is true. An in-visit confirm already reloads the loader (`afterConfirm`), so the same path serves the in-visit case.
- Step 3 renders a `MeetingWeekPlan` block through a slot prop, so `MeetingBody` stays hook-free. The Obnovit logic is a pure module, as `createConfirm` is in `meetingFlow.ts`.

**Tech Stack:** TanStack Start (route loader, server fn), Drizzle/SQLite (one read), React 19, Tailwind, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.9 step 3, §5.12 ("At the meeting", "The plan table (Týden)"); UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §7.3 M3Plan.

**Size:** about 190 changed lines, not counting tests, migrations and generated files.

| File | Lines |
| --- | --- |
| `server/settlement/meeting.ts` | +15 |
| `server/demo/pieces.ts` | +20 (a test-only piece) |
| `planRefresh.ts` | ~45 |
| `MeetingWeekPlan.tsx` | ~65 |
| `MeetingScreen.tsx` | +14 |
| `meetingFlow.ts` | +6 |
| `schuzka.tsx` | +8 |
| `instances/functions.ts` | +2 |
| `strings.ts` | +6 |
| `seeds.ts` | +3 |
| `e2e/suites.ts` | +3 |

**Protected areas:**
- No DB schema, migration, audit, `src/domain`, auth, scheduler, CI or dependency change. `src/domain/dates.ts` is used, not changed.
- It adds keys to the Czech strings module (`src/lib/strings.ts`), a protected shared module. So it is **not** a small PR, and it keeps this plan and the plan rounds.
- It changes the meeting read (`getMeeting`, §5.9) with one new read-only field. That is server code, not the §5 domain layer, but it sits next to settlement. So the panel should include the **Rules** judge, in addition to Tests, UX and Architecture. It also changes what a server function returns (`getMeetingFn` gains `settledToday`), so **Security** joins the code-phase panel (pr-review-rounds §2).

## Decisions

- **The table shows on the day of the latest settlement** (Jakub 2026-11-26).
  - First answer: "only right after a settlement confirmed in this visit".
  - Refined, in his words: "if you set up the week that day, then you can see the table there as well. If you look any other day than the day you settled, then it's not there."
  - Rule: with the switch on, step 3 shows the table when the latest settlement's `settled_at` falls on today's Prague calendar date. That holds in the visit that confirmed it and in any later visit the same day (leave, come back, still shown). From the next Prague day on, it is not shown, and nothing fetches it.
  - Step 3 reached on a day with no settlement ("Teď není co vyúčtovat", "Týden ještě běží") shows no table and makes no plan request.
- **Why** (Jakub 2026-11-26): at the meeting, after settling, the family goes on to plan the next week, so the parent needs the overview there during that meeting. After the meeting it doesn't matter.
- From Jakub's wireframe decisions: the table sits under the open one-time tasks; "Obnovit" refetches it and nothing refreshes it automatically; with the switch off, step 3 is unchanged.

## Where the loader learns the settlement time

- `settlements.settled_at` already holds each record's time (UTC ISO). A settlement writes one row per taker, all with the same `settledAt`. "Latest settlement" = `MAX(settled_at)` over `settlements`. Admin corrections are separate records and do not count; they are not a meeting.
- New in `src/server/settlement/meeting.ts`:
  - `lastSettledAt(db: Db | Tx): string | null`: one `select max(settled_at)`.
  - `settledOnPragueDay(settledAt: string | null, now: Date): boolean`: `settledAt !== null && pragueDaysBetween(parseIsoUtc(settledAt), now) === 0`. Both helpers come from `~/domain/dates` (calendar dates in Prague, DST-safe), with no hand-made offsets.
- `Meeting` (both variants) gets `settledToday: boolean`, filled by `getMeeting(db, now, …)` from the same `now`. That is one clock, the server's. `NOTHING` becomes a function of it.

## Which week, and how it maps onto `getWeekPlan`

- `getWeekPlan(db, now)` reads `currentPeriod(db, now)`. After a settlement of the running week, that is the week the settlement started (§5.8). Its copies exist at once (§5.12, #257). After a settlement of a week that had already ended at its cutoff, it is the next week, which started at that cutoff ("Tento týden běží dál"). The server function needs no new input. `weekPlan.test.ts` already pins the running-week case.
- In-visit: `afterConfirm` calls `router.invalidate()` after the confirm's answer. The loader reruns, `settledToday` is now true, and the plan is fetched. Until that reload lands, the block is not shown (a moment, with the confirm's own busy state). A settlement at 23:59 whose reload lands after midnight shows no table, which fits "any other day … not there".
- The table only renders at step 3 (`StepPlan`). With `settleLastDay` off (tests only), coming back the same day may open the new week's step 1. The loader then fetches a plan it does not show. That is accepted: production runs with the switch on, and there the week a settlement starts is never on its last day that same day.

## Global Constraints

- UI labels in Czech, only in `src/lib/strings.ts`. Code, identifiers and commits in English.
- Prague wall-clock maths only through `src/domain/dates.ts`.
- Show the table only when `weekPlan` is on, `meeting.settledToday` is true, and the step is 3 (Jakub 2026-11-26). Otherwise step 3 is unchanged and no `getWeekPlanFn` call is made.
- Giver view: `viewer = { id: user.id, role: 'giver' }`. Every cell tap opens that copy's task page (`tapAction` from #258; nothing new).
- No auto-refresh. The table changes through a route reload or "Obnovit" (Jakub, wireframe; §5.12 [call]).
- `Screen` is `wide` exactly while the plan block shows.
- Taps are at least 44 px (`min-h-tap` / `size-tap`). Every animation has a `motion-reduce:` opt-out.
- Component tests render static markup only. Logic goes in a plain module.
- Reuse `WeekPlanTable`, `planView.ts` and `cs.plan` from #258. Do not fork them.

## Review Focus

1. **The day boundary in Prague, not UTC.** A settlement at 00:30 Prague on 26. 11. is `2026-11-25T23:30Z`, which is the day before by UTC date. A naive UTC date compare hides the table for the first hour of the day. The DST days (25 h, 23 h) are the other trap. Pinned by Task 1's `settledOnPragueDay` cases.
2. **Step 3 on a day without a settlement** (nothing to settle, the week still running): no block, no request, narrow screen. Pinned by Task 1's `getMeeting` cases and Task 4's loader and render tests.
3. **A refresh answer that comes back after the route reloaded** must not cover newer loader data. Pinned by Task 2 `drops an answer started from an older loader plan`.
4. **Obnovit twice, quickly or one after the other:** one request at a time, and the second answer shows. A failed fetch can be retried. Pinned by Task 2 `a second refresh while one is on its way does nothing`, `two consecutive taps…`, `a thrown fetch dispatches failed, and the next call fetches again`.
5. **The server answers `feature_off`** (the switch went off after the app started): the block is hidden and the screen narrow. Pinned by Task 2 `planShown` and Task 3 `feature_off answer renders nothing`.

---

### Task 1: `settledToday` on the meeting read

**Files:**
- Modify: `src/server/settlement/meeting.ts`
- Modify: `src/components/meeting/fixtures.ts` (every `Meeting` fixture gets `settledToday: false`, overridable)
- Test: `src/server/settlement/meeting.test.ts`, `src/server/settlement/functions.test.ts` (shape)

**Interfaces:**
- Produces: `lastSettledAt(db: Db | Tx): string | null`. `settledOnPragueDay(settledAt: string | null, now: Date): boolean`. `Meeting` = the two existing variants, each with `settledToday: boolean`.

- [ ] **Step 1: Write the failing tests.** Build the instants with the existing `prague(y, m, d, h, min?)` helper from `./testing`; never write UTC offsets by hand.
  - `settledOnPragueDay: null → false`.
  - `settled at today 00:00 Prague → true`, with `now` today 00:01 and with `now` today 23:59.
  - `settled at yesterday 23:59 Prague → false`, with `now` today 00:00 and with `now` today 00:01.
  - `UTC date differs, Prague date same`: settled `2026-11-25T23:30:00.000Z` (26. 11. 00:30 Prague), `now = prague(2026, 11, 26, 10)` → true. Settled `2026-11-25T22:59:00.000Z` (25. 11. 23:59 Prague), same `now` → false.
  - `DST autumn (25 h day, 2026-10-25)`: settled `prague(2026, 10, 25, 0, 30)`, `now = prague(2026, 10, 25, 23, 30)` → true. `now = prague(2026, 10, 26, 0, 5)` → false.
  - `DST spring (23 h day, 2026-03-29)`: settled `prague(2026, 3, 29, 0, 10)`, `now = prague(2026, 3, 29, 23, 50)` → true. Settled `prague(2026, 3, 28, 23, 30)`, `now = prague(2026, 3, 29, 0, 30)` → false.
  - `lastSettledAt: null with no settlements; the latest of two settled weeks`: settle two weeks with the existing `week()`/`settlePeriod` helpers → it returns the second's `settledAt`.
  - `getMeeting: settledToday true the same Prague day after settling, false the next day`: settle at Sunday 20:00. `getMeeting(db, Sunday 23:59, true).settledToday` is true, and at Monday 00:00 it is false. Check both on the variant that comes back; with the last-day rule on, that is `period: null`.
  - `getMeeting: settledToday false with no settlement ever`, on both a "nothing to settle" db and a running-week db.
  - Shape (`functions.test.ts`): `getMeetingFn`'s handler body (`meetingNow`) returns exactly the old keys plus `settledToday` (`Object.keys` sorted), with no settlement rows leaked.
- [ ] **Step 2: Run** `pnpm test src/server/settlement`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement** the two helpers and the field. `getMeeting` computes `settledToday = settledOnPragueDay(lastSettledAt(db), now)` once at the top and puts it on every return. Fix the `Meeting` fixtures and literals that typecheck flags.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: PASS. Then `pnpm mutation --mutate src/server/settlement/meeting.ts` and kill the survivors on the new lines.
- [ ] **Step 5: Commit** `Tell the meeting whether a week was settled today`.

### Task 2: Refresh state and visibility (pure)

**Files:**
- Create: `src/components/meeting/planRefresh.ts`
- Modify: `src/server/instances/functions.ts` (`PlanAnswer`, next to `WeekPlan`)
- Modify: `src/components/meeting/meetingFlow.ts` (`planShown`)
- Test: `src/components/meeting/planRefresh.test.ts`, `src/components/meeting/meetingFlow.test.ts`

**Interfaces:**
- Produces, in `~/server/instances/functions`: `export type PlanAnswer = WeekPlan | { error: 'feature_off' }`. This becomes `weekPlanHandler`'s return type.
- Produces, in `planRefresh.ts`:
  ```ts
  export interface RefreshState { base: PlanAnswer | null; plan: PlanAnswer | null; busy: boolean; failed: boolean }
  export const REFRESH_START: RefreshState
  export type RefreshEvent =
    | { type: 'sending'; base: PlanAnswer }
    | { type: 'answer'; base: PlanAnswer; plan: PlanAnswer }
    | { type: 'failed'; base: PlanAnswer }
  export function refreshReduce(s: RefreshState, e: RefreshEvent): RefreshState
  /** What to draw: the refreshed plan only while it was fetched on top of the current loader plan. */
  export function refreshView(s: RefreshState, loaded: PlanAnswer): { plan: PlanAnswer; busy: boolean; failed: boolean }
  /** One call at a time (as createConfirm); the in-flight flag is cleared in `finally`. */
  export function createRefresh(fetch: () => Promise<PlanAnswer>, dispatch: (e: RefreshEvent) => void): (base: PlanAnswer) => Promise<void>
  /** The Obnovit tap: always sends the loader plan as `base`, never the plan on screen. */
  export function refreshTap(refresh: (base: PlanAnswer) => Promise<void>, loaded: PlanAnswer): () => void
  ```
  Rules:
  - `sending` sets `busy`, clears `failed`, and keeps `plan` only if `base` is unchanged.
  - `answer` and `failed` always clear `busy`, but set `plan` or `failed` only when `e.base === s.base`.
  - `refreshView` returns `{ plan: loaded, busy, failed: false }` when `s.base !== loaded`, otherwise `{ plan: s.plan ?? loaded, busy, failed }`.
  - Compare by identity: every loader run returns a new object.
- Produces, in `meetingFlow.ts`: `planShown(step: MeetingStep, settledToday: boolean, weekPlan: PlanAnswer | null): boolean`. It is true only for `step === 3`, `settledToday`, and a `weekPlan` that is a `WeekPlan` (not `null`, not `feature_off`). `MeetingScreen` passes the plan from `refreshView`, so a `feature_off` answer to Obnovit hides the block and makes the screen narrow too. To pin that wiring, `planRefresh.ts` also exports `meetingPlanView(step: MeetingStep, settledToday: boolean, state: RefreshState, loaded: PlanAnswer | null): { view: RefreshView | null; shown: boolean }` (it calls `refreshView` then `planShown` on `view.plan`); `MeetingScreen` uses it as is.

- [ ] **Step 1: Write the failing tests** (fixtures: `planFixture()`; distinct plans `a`, `b`, `c`):
  - `before any refresh the loader plan shows`.
  - `an answer replaces the plan`: sending(a), answer(a, b) → the view's plan is `b`.
  - `drops an answer started from an older loader plan`: sending(a), loader gives `c`, answer(a, b) → `refreshView(s, c).plan === c`, `busy` false.
  - `a newer loader plan wins over an earlier refresh`.
  - `sending keeps plan when base is unchanged`: sending(a), answer(a, b), sending(a) → `{ plan: b, busy: true, failed: false }`. With sending(c) instead → plan `c`.
  - `failed keeps the table and sets failed`. A following sending clears it.
  - `a second refresh while one is on its way does nothing`: one fetch, one `sending`. After it resolves, a third call fetches.
  - `a thrown fetch dispatches failed, and the next call fetches again`: `[sending, failed]`, nothing thrown. The second call fetches (count 2) and dispatches `[sending, answer(a, b)]`.
  - `two consecutive taps: the second tap's answer shows`: the real reducer as dispatch, a fetch resolving `b` then `c`, and `await refreshTap(refresh, a)()` twice → `refreshView(state, a).plan === c`, `busy` false.
  - `planShown`: `(3, true, a)` true. False for `(1, true, a)`, `(2, true, a)`, `(3, false, a)` (Jakub 2026-11-26: not on a day without a settlement), `(3, true, null)` and `(3, true, { error: 'feature_off' })`.
  - `meetingPlanView: an Obnovit answered feature_off hides the block although the loader had a plan`: `loaded = a`, state after `sending(a)`, `answer(a, { error: 'feature_off' })` → `shown` false. And with `answer(a, b)` → `shown` true and `view.plan === b`.
- [ ] **Step 2: Run** `pnpm test src/components/meeting`. Expected: FAIL.
- [ ] **Step 3: Implement** them.
- [ ] **Step 4: Run** again. Expected: PASS. Then `pnpm mutation --mutate src/components/meeting/planRefresh.ts src/components/meeting/meetingFlow.ts`.
- [ ] **Step 5: Commit** `Add the refresh state for the meeting's plan table`.

### Task 3: The plan block in step 3

**Files:**
- Create: `src/components/meeting/MeetingWeekPlan.tsx`
- Modify: `src/components/meeting/MeetingScreen.tsx` (`MeetingScreen`, `MeetingBody`, `StepPlan`; `frame`)
- Modify: `src/lib/strings.ts` (`cs.meeting`)
- Test: `src/components/meeting/meetingWeekPlan.test.tsx`, `src/components/meeting/meeting.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–2. `WeekPlanTable`, `weekLabel`, `getWeekPlanFn`.
- Produces:
  ```ts
  /** Hook-free: header, hint, error line, table. */
  export function MeetingWeekPlanView(props: { plan: PlanAnswer; busy: boolean; failed: boolean; viewerId: number; onRefresh: () => void }): ReactNode
  ```
- `MeetingBody` gets `weekPlan?: ReactNode` and passes it to `StepPlan`. `StepPlan` renders it **after** the open-tasks list (or its empty state) and **before** "+ Nový úkol" / "Ukončit schůzku".
- `MeetingScreen` gets `weekPlan?: PlanAnswer | null` (the loader's), `viewerId: number` and `frame?: (body: ReactNode, wide: boolean) => ReactNode` (default `(body) => body`). It holds `useReducer(refreshReduce, REFRESH_START)` and `createRefresh(() => getWeekPlanFn(), dispatch)` in `useMemo`.
  - With `loaded = weekPlan`, it computes `{ view, shown } = meetingPlanView(stepOf(meeting, ui), meeting.settledToday, state, loaded)`.
  - It returns `frame(<MeetingBody … weekPlan={shown ? <MeetingWeekPlanView {...view} viewerId={viewerId} onRefresh={refreshTap(refresh, loaded)} /> : undefined} />, shown)`.
- Strings (`cs.meeting`): `refresh: 'Obnovit'`, `planHint: 'Kluci si dny rezervují v Týdnu na svých telefonech. Pak klepni na Obnovit.'`, `refreshFailed: 'Plán se nepodařilo načíst. Zkus to znovu.'`. The title reuses `cs.plan.title`.

Layout (360 px, long names). `<section aria-labelledby="meeting-plan-label">`:
- A header row `flex flex-wrap items-center justify-between gap-2`. `SectionLabel id="meeting-plan-label"` and the week (`weekLabel(startsAt, cutoffAt)`, `num text-meta text-muted`) sit in a `min-w-0` box that wraps. The Obnovit `Button variant="ghost"` (default size → `min-h-tap`) is `shrink-0` and stays whole. While busy it is `disabled` and `aria-busy`, with `RefreshCw` `animate-spin motion-reduce:animate-none`, and keeps its label.
- The hint below it, which wraps.
- When failed: `<p role="alert" className="text-meta font-bold text-destructive break-words">`. Obnovit is the retry, and the table stays.
- `WeekPlanTable plan={plan} viewer={{ id: viewerId, role: 'giver' }}`. Long names are #258's (pinned column, `line-clamp-3`, full name in each cell's `aria-label`).
- A `feature_off` plan → `null`.

- [ ] **Step 1: Write the failing tests** in `meetingWeekPlan.test.tsx` (router and tasks mocks as in `planPage.test.tsx`):
  - `header, week, hint and a giver table`: `>Plán týdne<`, `29. 11. – 6. 12.`, `cs.meeting.planHint`, `cs.meeting.refresh`, `aria-label="Prostřít stůl k večeři, St: volné"`, and no `cs.plan.tapHint`.
  - `busy: Obnovit disabled, aria-busy, spinner has motion-reduce`.
  - `refresh failed: message, table still there, button enabled`.
  - `feature_off answer renders nothing`.
  - `empty plan: #258 empty state under the header`: `cs.week.noPeriod`, `cs.plan.noRows`.
  - `tap targets`: `min-h-tap` on Obnovit.
- [ ] **Step 2: Add to `meeting.test.tsx`:**
  - `step 3 renders the weekPlan slot after the open tasks and before Ukončit schůzku`.
  - `steps 1 and 2 never render the slot`.
  - The existing step 3 tests stay unchanged.
- [ ] **Step 3: Run** `pnpm test src/components/meeting`. Expected: FAIL.
- [ ] **Step 4: Implement** them. The tap is `refreshTap(refresh, loaded)`, with no other tap logic in the component.
- [ ] **Step 5: Run** `pnpm test src/components/meeting && pnpm typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 6: Commit** `Show the week plan table in the meeting's step 3`.

### Task 4: The route: fetch the plan on the settlement's day

**Files:**
- Modify: `src/routes/_app/schuzka.tsx`
- Test: `src/components/meeting/schuzkaPage.test.tsx`

Change:
- `loader: async ({ context }) => { const meeting = await getMeetingFn(); return { meeting, plan: await listPlanTasksFn(), weekPlan: context.features.weekPlan && meeting.settledToday ? await getWeekPlanFn() : null } }`.
- The component renders `<MeetingScreen … weekPlan={weekPlan} viewerId={user.id} frame={(body, wide) => <Screen title={cs.nav.meeting} user={user} wide={wide}>{body}</Screen>} />`.

- [ ] **Step 1: Update and extend the tests** (mock `getWeekPlanFn` to resolve `'week'`, and `getMeetingFn` per test):
  - `switch off: meeting and plan tasks only`: `{ …, weekPlan: null }`, and `getWeekPlanFn` is not called, even with `settledToday: true`.
  - `switch on, not settled today: no plan request` (Jakub 2026-11-26): `settledToday: false` → `weekPlan: null`, not called.
  - `switch on, settled today: the plan is fetched`: → `weekPlan: 'week'`, called once.
  - `renders step 3 with the table when settled today` ("Týden ještě běží" fixture, `settledToday: true`, `weekPlan: planFixture()`) → `>Plán týdne<`, `cs.meeting.refresh`, `landscape:max-w-3xl`.
  - `step 3 on a day without a settlement: unchanged and narrow` (`settledToday: false`, `weekPlan: null`, for the "nothing to settle" and the "Týden ještě běží" fixtures) → `cs.meeting.planTasks` present, and no `>Plán týdne<`, no `cs.meeting.refresh`, no `landscape:max-w-3xl`.
  - `step 1 with a plan loaded: narrow, no table` (`pendingWeek()` with `settledToday: true`).
  - `feature_off answer: step 3 narrow and unchanged`.
  - (Wrong actor) `beforeLoad` with the switch on: a taker is redirected to his landing page, the admin to `/sprava`, and a giver stays. `screenGuard.test.ts` has no Schůzka case.
- [ ] **Step 2: Run** `pnpm test src/components/meeting/schuzkaPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS. `routeTree.gen.ts` does not change.
- [ ] **Step 5: Commit** `Load the week plan at Schůzka on the settlement's day`.

### Task 5: E2E: settle, Obnovit, leave and come back

**Suite: its own row** (`meeting-plan`), not an extension of `week-plan`. It settles a week for good, which changes the periods that `week-plan.spec.ts`'s serial tests rely on, and it needs the `meeting` and `settleLastDay` switches.

**Seed.** The come-back case needs step 3 on return, which in production means the last-day rule is on. To settle on any weekday with it on, the seed has an **ended**, unsettled week (settling one is allowed any time after its cutoff, §5.8), and a running week that is never on its last day today.
- New test-only piece `endedWeek` in `src/server/demo/pieces.ts`:
  - `rollPeriods(tx, addPragueDays(startOfPragueDay(now), -11), defaults)`, so a 7-day week ends at the Sunday cutoff 1–7 days ago.
  - Then `writePeriodDefaults(tx, <the seed's system actor, as `SEED_LOG` uses>, { ...defaults, lengthDays: 14 }, at)`, so the running week, rolled later from that cutoff, ends 7 or more days from now.
  - Then `rollPeriods(tx, now, …)`.
  - A doc comment says why.
  - It is not added to `demo`: the demo already settles its past week at seed time, and a second ended week would change every preview's Týden and Schůzka. That is CLAUDE.md's rule ("adds its piece to demo") applied to a test fixture, and it is stated in the brief.
- `seeds.ts`: `planmeeting: { pieces: [endedWeek, planTable], features: ['recurring', 'week', 'meeting', 'weekPlan', 'settleLastDay'] }`. With a week running, `planTable` agrees its chores now and makes copies from the next slot.
- `e2e/suites.ts`: `{ name: 'meeting-plan', spec: 'meeting-plan.spec.ts', seed: 'planmeeting' }`, with a comment.
- `src/server/demo/suites.test.ts`: a `planmeeting` case. There is one ended unsettled week, the running week's last day is not today, `meeting`, `weekPlan` and `settleLastDay` are on, and `getMeeting(...).settledToday` is false.

**Files:** the above, plus create `e2e/meeting-plan.spec.ts` and modify `e2e/meeting.spec.ts`.

- [ ] **Step 1: Write `e2e/meeting-plan.spec.ts`** (`PHONE`, serial):
  1. Táta opens `/schuzka`: step 1 ("Všechno schváleno"), no plan section. Count the plan server-fn requests with `page.on('request')`: none so far. Dál → Potvrdit vyúčtování → Vyúčtovat.
  2. Step 3: `cs.meeting.stillRunning` is visible, and the plan section is visible below `cs.meeting.planTasks`. One plan request has been made.
  3. `cell = section.locator('button[aria-label^="Prostřít stůl k večeři, "]').first()`. Read `day = data-day`; the label ends in `: volné`.
  4. Second context: Starší reserves that `data-day` cell on `/tyden/plan`.
  5. Táta's cell still says `: volné`. Obnovit → `: rezervováno, Starší`, and the button is enabled again.
  6. Starší frees it (Uvolnit sheet). Obnovit a **second** time → `: volné`.
  7. **Leave and come back:** Táta taps the Týden tab, then the Schůzka tab. Step 3 shows `cs.meeting.notYet` ("Týden ještě běží"), and the plan section is visible again with the same week label.
  8. Táta taps the cell → `/ukol/\d+$`.
- [ ] **Step 2: Extend `e2e/meeting.spec.ts`** (`week` seed, switch off): after settling, there is no plan section and no Obnovit.
- A "next day" e2e is not possible without a server clock. The boundary is pinned in Task 1.
- [ ] **Step 3: Run** `pnpm build && pnpm exec playwright test e2e/meeting-plan.spec.ts e2e/meeting.spec.ts`, and `pnpm test src/server/demo`. Expected: PASS.
- [ ] **Step 4: Commit** `Test the week plan at Schůzka end to end`.

No `e2e/keyboard.spec.ts` case: this PR adds no form or text field.

### Task 6: Screenshots and final check

- [ ] **Step 1: Take one set** (skill `pr-review-rounds` §1 code phase): iPhone 15 Pro 393×852, `deviceScaleFactor: 3`, light, `TASKMASTER_SEED=planmeeting`, logged in as `tata`, in one folder outside the repo:
  - `schuzka-giver-plan.png`: step 3 after the settle, at the plan block (long name "Vyluxovat celý obývák a chodbu").
  - `schuzka-giver-plan-tasks.png`: the top of step 3 above the block.
  - `schuzka-giver-plan-busy.png`: Obnovit busy (delay the request with `page.route`).
  - `schuzka-giver-plan-error.png`: Obnovit failed (abort it): message plus table.
  - `schuzka-giver-plan-reserved.png`: after Obnovit, Starší's avatar in the cell.
  - `schuzka-giver-plan-return.png`: back from Týden, "Týden ještě běží" with the table.
  - `schuzka-giver-plan-landscape.png`: 852×393 (`wide`).
  - `schuzka-giver-plan-360.png`: 360×800. The header wraps, Obnovit stays whole, and the name is clamped at three lines.
  - `schuzka-giver-plan-off.png`: seed `week` (switch off), step 3 as before.
  - The empty states are #258's, unchanged inside the block. The static tests cover them; the brief says so.

  Look at each one. Whatever a person needs to read or tap must be whole.
- [ ] **Step 2: Verify** (`superpowers:verification-before-completion`): `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`. All pass.

## Pre-flight checklist (pr-review-rounds §1)

Tests:
- Audit rollback: n/a. There is no new state change; `settledToday` is a read.
- Boundaries: the Prague-day cutoff of `settledToday`, exactly at 00:00, 23:59 and across both DST days, and UTC-vs-Prague (Task 1).
- Wrong actor: Task 4 (taker, admin). `getMeetingFn` stays `requireRole('giver')`, and `getWeekPlanFn` stays giver or taker.
- Real entry point: the Task 5 e2e through `/schuzka`, including the return visit. Task 4 runs the route's loader and component.
- Server function shape: `getMeetingFn`'s keys are pinned with `settledToday` (Task 1). `weekPlanHandler`'s shape is pinned by #258.

UX:
- 44 px: Obnovit (`min-h-tap`, Task 3 test). The cells are #258's.
- motion-reduce: the spinner has `motion-reduce:animate-none`.
- Busy / error / retry: Task 3 (busy button, Czech message, Obnovit retries). A loader failure goes to the existing `RouteError`.
- Empty and error states: #258's empty states inside the block. `feature_off` hides it.
- Irreversible action: none new.
- Long Czech name at 360 px: Task 3 layout and the `-360` screenshot.
