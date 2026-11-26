# Week plan at Schůzka Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (CLAUDE.md PR flow step 3). Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#259 Show the week plan at Schůzka](https://github.com/SlatinskyJ/taskmaster/issues/259), depends on [#258](https://github.com/SlatinskyJ/taskmaster/issues/258) (merged as PR #297).

**Goal:** With the `weekPlan` switch on, Schůzka step 3 (Plan) shows #258's plan table, giver view, under the open one-time tasks. It shows only right after a settlement confirmed in this visit, and an "Obnovit" button refetches the table.

**Architecture:** No server change and no loader change. Once the confirm's answer is in (`ui.result` set), `MeetingScreen` fetches #258's `getWeekPlanFn` itself and keeps the answer in a small reducer. The reducer and the one-request-at-a-time fetch live in a pure module (`planRefresh.ts`, like `createConfirm` in `meetingFlow.ts`). The drawing (`MeetingWeekPlanView`) is hook-free and goes into `MeetingBody` through a slot prop.

**Tech Stack:** TanStack Start (server fn), React 19, Tailwind, Vitest (static markup), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.9 step 3, §5.12 ("At the meeting", "The plan table (Týden)"); UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §7.3 M3Plan.

**Size:** about 155 changed lines, not counting tests, migrations and generated files: `planRefresh.ts` ~40, `MeetingWeekPlan.tsx` ~60, `MeetingScreen.tsx` +25, `meetingFlow.ts` +8, `schuzka.tsx` +6, `functions.ts` +2, `strings.ts` +7, `seeds.ts` +3, `e2e/suites.ts` +3. This is under 300 lines, but it adds keys to the Czech strings module (`src/lib/strings.ts`), and CLAUDE.md lists that module as a protected shared module. So this is **not** a small PR, and it gets this plan and the plan rounds. Nothing else it touches is protected: no schema, domain, auth, scheduler, CI or dependency change.

## Decisions

- **The table shows only right after a settlement confirmed in this visit** (Jakub 2026-11-26, answering this plan's open question). The condition is `ui.result !== null`. When step 3 is reached with no settlement, there is no table and no `getWeekPlanFn` request. That covers "Teď není co vyúčtovat", "Týden ještě běží" (#211), and any other step 3 without `ui.result`.
- From Jakub's wireframe decisions: the table sits under the open one-time tasks; "Obnovit" refetches it and nothing refreshes it automatically; with the switch off, step 3 is unchanged.

## Which week, and how it maps onto `getWeekPlan`

- `getWeekPlan(db, now)` reads `currentPeriod(db, now)`. Confirming the settlement ends the old period at that moment and starts the next (§5.8). The next one's copies exist at once (§5.12, #257).
- The first fetch is sent only after the confirm's answer has arrived (`ui.result` set), so the settlement is already committed. The period running "now" is then the week the settlement just started. The server function needs no new input. `weekPlan.test.ts` already pins this server-side ("a meeting ends the week early on Sunday 20:00 …"). The Task 4 e2e pins it end to end.
- If the settled week had already ended at its cutoff (`result.next` null, "Tento týden běží dál"), the period running now is the next week, which started at that cutoff. That is the table shown.
- The route loader is not changed: it never fetches the plan. So the switch off, steps 1–2, and step 3 without a settlement make no request.

## Global Constraints

- UI labels in Czech, only in `src/lib/strings.ts`. Code, identifiers and commits in English.
- Show the table only when `weekPlan` is on **and** `ui.result !== null` (Jakub 2026-11-26). Otherwise step 3 is unchanged and no `getWeekPlanFn` call is made.
- Giver view: `viewer = { id: user.id, role: 'giver' }`. Every cell tap opens that copy's task page (`tapAction` from #258; nothing new).
- No auto-refresh. After the first load, the table changes only through "Obnovit" (Jakub, wireframe; §5.12 [call] "updates when reloaded").
- `Screen` is `wide` exactly while the plan block shows.
- Taps are at least 44 px (`min-h-tap` / `size-tap`). Every animation has a `motion-reduce:` opt-out.
- Component tests render static markup only. Logic goes in a plain module.
- Reuse `WeekPlanTable`, `planView.ts` and `cs.plan` from #258. Do not fork them.

## Review Focus

1. **Step 3 without a settlement in this visit** (nothing to settle, the week still running): no block, no request, narrow screen (Jakub 2026-11-26). Pinned by Task 1 `planShown` cases and Task 3 `step 3 without a settlement: no table, no request, narrow`.
2. **Obnovit tapped twice quickly** sends one request. Two taps one after the other each fetch, and the second answer shows. Pinned by Task 1 `a second refresh while one is on its way does nothing` and `two consecutive taps: the second tap's answer shows`.
3. **A fetch fails (offline, 500), on the first load or on Obnovit.** A Czech message shows, Obnovit retries, and a table already loaded stays. Pinned by Task 1 `failed keeps the plan and sets failed` and `a thrown fetch dispatches failed, and the next call fetches again`, and by Task 2's view tests.
4. **The server answers `feature_off`** (the switch went off after the app started; launch switches load at app start). The block is hidden and the screen narrow, as with the switch off. Pinned by Task 1 `planShown` and Task 2 `feature_off answer renders nothing`.
5. **No period, or no chore with schedule days.** #258's empty states show inside the block, and Obnovit still works. Pinned by Task 2 `empty plan: #258 empty state under the header`.

---

### Task 1: Plan state and fetch (pure)

**Files:**
- Create: `src/components/meeting/planRefresh.ts`
- Modify: `src/server/instances/functions.ts` (the `PlanAnswer` type, next to `WeekPlan`)
- Test: `src/components/meeting/planRefresh.test.ts`

**Interfaces:**
- Consumes: `WeekPlan` from `~/server/instances/functions`. `SettledOk` from `./meetingFlow`.
- Produces, in `~/server/instances/functions` next to the `WeekPlan` re-export: `export type PlanAnswer = WeekPlan | { error: 'feature_off' }`. `weekPlanHandler` gets this return type, and nothing else changes there.
- Produces, in `planRefresh.ts`:
  ```ts
  export interface PlanState { plan: PlanAnswer | null; busy: boolean; failed: boolean }
  export const PLAN_START: PlanState // { plan: null, busy: false, failed: false }
  export type PlanEvent = { type: 'sending' } | { type: 'answer'; plan: PlanAnswer } | { type: 'failed' }
  export function planReduce(s: PlanState, e: PlanEvent): PlanState
  /** The fetch for the first load and for every Obnovit tap: at most one call at a time (as createConfirm). */
  export function createRefresh(fetch: () => Promise<PlanAnswer>, dispatch: (e: PlanEvent) => void): () => Promise<void>
  /** Jakub 2026-11-26: only after a settlement confirmed in this visit, with the switch on, and not on a feature_off answer. */
  export function planShown(result: SettledOk | null, switchOn: boolean, state: PlanState): boolean
  /** Send the first fetch: the block shows and nothing has been asked yet. */
  export function shouldLoad(result: SettledOk | null, switchOn: boolean, state: PlanState): boolean
  ```
  Rules:
  - `sending` sets `busy: true` and `failed: false`, and keeps `plan`.
  - `answer` sets `plan` and `busy: false`.
  - `failed` sets `busy: false` and `failed: true`, and keeps `plan`.
  - `planShown` = `result !== null && switchOn && !(state.plan && 'error' in state.plan)`. While loading (`plan` null) it is true, so the block shows its busy state.
  - `shouldLoad` = `planShown(...) && state.plan === null && !state.busy && !state.failed`.

- [ ] **Step 1: Write the failing tests** (fixtures: `planFixture()` from `~/components/week/fixtures`, `settledOk()` from `./fixtures`, distinct plans `a`, `b`, `c`):
  - `an answer sets the plan`: sending, answer(a) → `{ plan: a, busy: false, failed: false }`.
  - `sending keeps the plan`: answer(a), then sending → `{ plan: a, busy: true, failed: false }` (the last table stays while the next one loads).
  - `failed keeps the plan and sets failed`: answer(a), sending, failed → `{ plan: a, busy: false, failed: true }`. A following sending clears `failed`.
  - `a second refresh while one is on its way does nothing`: `createRefresh` with a fetch that returns a pending promise, called twice → fetch called once, `sending` dispatched once. After it resolves, a third call fetches again.
  - `a thrown fetch dispatches failed, and the next call fetches again`: fetch rejects → events `[sending, failed]`, and nothing is thrown out of the returned function. A second call calls fetch again (call count 2) and, resolving `b`, dispatches `[sending, answer(b)]`. The in-flight flag is cleared in `finally`.
  - `two consecutive taps: the second tap's answer shows`: the real wiring. `let state = PLAN_START`, `dispatch = (e) => { state = planReduce(state, e) }`, `tap = createRefresh(fetch, dispatch)`, with a fetch resolving `b` then `c`. `await tap()` twice → `state.plan === c`, `busy` false, fetch called twice.
  - `planShown` (Jakub 2026-11-26): `(settledOk(), true, PLAN_START)` true; `(settledOk(), true, { …, plan: a })` true; `(null, true, PLAN_START)` false (step 3 with nothing settled); `(null, true, { …, plan: a })` false; `(settledOk(), false, PLAN_START)` false; `(settledOk(), true, { …, plan: { error: 'feature_off' } })` false.
  - `shouldLoad`: true only for `(settledOk(), true, PLAN_START)`. False with `result` null, with the switch off, while `busy`, after `failed` (a retry is Obnovit's job), and once `plan` is set.
- [ ] **Step 2: Run** `pnpm test src/components/meeting/planRefresh.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `PlanAnswer` in `functions.ts` and `planRefresh.ts` with the signatures above. Use an in-flight flag in the closure, cleared in `finally`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then run `pnpm mutation --mutate src/components/meeting/planRefresh.ts` and kill the surviving mutants with assertions.
- [ ] **Step 5: Commit** `Add the plan state for the meeting's plan table`.

### Task 2: The plan block in step 3

**Files:**
- Create: `src/components/meeting/MeetingWeekPlan.tsx`
- Modify: `src/components/meeting/MeetingScreen.tsx` (props of `MeetingScreen`, `MeetingBody`, `StepPlan`; the plan state; `frame`)
- Modify: `src/lib/strings.ts` (`cs.meeting`)
- Test: `src/components/meeting/meetingWeekPlan.test.tsx`, `src/components/meeting/meeting.test.tsx`

**Interfaces:**
- Consumes: Task 1. `WeekPlanTable` (`plan`, `viewer`) from `~/components/week/WeekPlanTable`. `weekLabel` from `~/components/period/periodView`. `getWeekPlanFn` from `~/server/instances/functions`.
- Produces:
  ```ts
  /** Hook-free: header, hint, busy/error line, table. */
  export function MeetingWeekPlanView(props: { state: PlanState; viewerId: number; onRefresh: () => void }): ReactNode
  ```
- `MeetingBody` gets `weekPlan?: ReactNode` (default none) and passes it to `StepPlan`. It stays hook-free. `StepPlan` renders the slot **after** the open-tasks list (or its empty state) and **before** the "+ Nový úkol" / "Ukončit schůzku" buttons.
- `MeetingScreen` gets `weekPlanOn?: boolean` (default false), `viewerId: number` and `frame?: (body: ReactNode, wide: boolean) => ReactNode` (default `(body) => body`). It holds:
  - `const [planState, planDispatch] = useReducer(planReduce, PLAN_START)`.
  - `const refresh = useMemo(() => createRefresh(() => getWeekPlanFn(), planDispatch), [])`.
  - `useEffect(() => { if (shouldLoad(ui.result, weekPlanOn, planState)) void refresh() })`.
  - `const shown = planShown(ui.result, weekPlanOn, planState)`.
  - It returns `frame(<MeetingBody … weekPlan={shown ? <MeetingWeekPlanView state={planState} viewerId={viewerId} onRefresh={() => void refresh()} /> : undefined} />, shown)`.
- Strings (`cs.meeting`): `refresh: 'Obnovit'`, `planHint: 'Kluci si dny rezervují v Týdnu na svých telefonech. Pak klepni na Obnovit.'`, `planLoading: 'Načítám plán…'`, `refreshFailed: 'Plán se nepodařilo načíst. Zkus to znovu.'`. The section title reuses `cs.plan.title` ("Plán týdne").

Layout (360 px, long names). `<section aria-labelledby="meeting-plan-label">`:
- A header row `flex flex-wrap items-center justify-between gap-2`. `SectionLabel id="meeting-plan-label"` ("Plán týdne") and, once a plan with a period is in, the week (`weekLabel(startsAt, cutoffAt)`, `num text-meta text-muted`) sit in a `min-w-0` box that wraps. The Obnovit `Button variant="ghost"` (default size → `min-h-tap`) is `shrink-0` and stays whole. While busy it is `disabled` and `aria-busy`, shows a `RefreshCw` icon with `animate-spin motion-reduce:animate-none`, and keeps its label.
- The hint below it (`text-meta text-muted`, wraps).
- `plan` null and busy: `<p aria-live="polite" className="text-meta text-muted">` `cs.meeting.planLoading`.
- When failed: `<p role="alert" className="text-meta font-bold text-destructive break-words">` `cs.meeting.refreshFailed`. Obnovit is the retry. The last table stays below it, if there is one.
- A plan that is a `WeekPlan`: `WeekPlanTable plan={plan} viewer={{ id: viewerId, role: 'giver' }}`. Long chore names are #258's (pinned column, `line-clamp-3`, full name in each cell's `aria-label`). Nothing new is cut.
- A plan that is `{ error: 'feature_off' }`: render `null`. `MeetingScreen` does not render it then anyway, because `planShown` is false.

- [ ] **Step 1: Write the failing tests** in `meetingWeekPlan.test.tsx`. Mock `@tanstack/react-router` (`useRouter` with `navigate`, `invalidate`) and `~/server/tasks/functions` as `planPage.test.tsx` does. Render `MeetingWeekPlanView` statically:
  - `header, week, hint and a giver table`: `state = { plan: planFixture(), busy: false, failed: false }` → contains `>Plán týdne<`, `29. 11. – 6. 12.`, `cs.meeting.planHint`, `cs.meeting.refresh`, `aria-label="Prostřít stůl k večeři, St: volné"` (the giver label), and not `cs.plan.tapHint`.
  - `first load: busy line, Obnovit disabled, spinner has motion-reduce`: `{ plan: null, busy: true, failed: false }` → contains `cs.meeting.planLoading`, `aria-busy="true"`, `disabled`, `motion-reduce:animate-none`; no `data-slot="plan-days"`.
  - `first load failed: message and Obnovit, no table`: `{ plan: null, busy: false, failed: true }` → `role="alert"`, `cs.meeting.refreshFailed`, Obnovit not disabled, no `data-slot="plan-days"`.
  - `refresh failed: message, table still there, button enabled`: `{ plan: planFixture(), busy: false, failed: true }` → `role="alert"` and `data-slot="plan-days"`.
  - `feature_off answer renders nothing`: `renderToStaticMarkup(...) === ''`.
  - `empty plan: #258 empty state under the header`: `planFixture({ period: null, days: [], rows: [] })` → contains `cs.week.noPeriod` and `cs.meeting.refresh`. With `rows: []` → `cs.plan.noRows`.
  - `tap targets`: the Obnovit button's markup has `min-h-tap`.
- [ ] **Step 2: Add to `meeting.test.tsx`** (existing mocks):
  - `step 3 renders the weekPlan slot after the open tasks and before Ukončit schůzku`: `MeetingBody` with a `settledOk()` ui and `weekPlan={<div data-testid="slot" />}` → the slot's index in the html is after `cs.meeting.planTasks` and before `cs.meeting.end`.
  - `steps 1 and 2 never render the slot`: `pendingWeek()` at step 1 and at step 2 → no `data-testid="slot"`.
  - The existing step 3 tests stay unchanged (no slot passed).
- [ ] **Step 3: Run** `pnpm test src/components/meeting`. Expected: the new cases FAIL.
- [ ] **Step 4: Implement** the strings, `MeetingWeekPlan.tsx`, and the state, effect, slot and `frame` in `MeetingScreen.tsx`. The tap is `() => void refresh()`, the same function the first load uses. There is no other tap logic in the component.
- [ ] **Step 5: Run** `pnpm test src/components/meeting && pnpm typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 6: Commit** `Show the week plan table after the settlement at Schůzka`.

### Task 3: The route: switch, viewer, frame

**Files:**
- Modify: `src/routes/_app/schuzka.tsx`
- Test: `src/components/meeting/schuzkaPage.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`MeetingScreen`'s `weekPlanOn`, `viewerId`, `frame`).
- Produces: nothing new. The loader stays `{ meeting, plan }`.

Change: the component renders `<MeetingScreen meeting={meeting} plan={plan} otherLevels={features.periodProposals} weekPlanOn={features.weekPlan} viewerId={user.id} frame={(body, wide) => <Screen title={cs.nav.meeting} user={user} wide={wide}>{body}</Screen>} />`. The loader is unchanged.

- [ ] **Step 1: Extend the tests.** Mock `~/server/instances/functions` (`getWeekPlanFn: vi.fn()`), add `reserveTaskFn` and `releaseTaskFn` to the tasks mock, and give the router context `features: { periodProposals: false, weekPlan: <per test> }`.
  - `the loader asks for the meeting and the plan tasks` keeps its assertions and adds `getWeekPlanFn` not called.
  - `step 3 without a settlement: no table, no request, narrow` (Jakub 2026-11-26): `weekPlan: true`, and `page.data = { meeting: <the fixture for "nothing to settle">, plan: [] }`, then the `runningCutoffAt` ("Týden ještě běží") fixture → each html has `cs.meeting.planTasks` but not `>Plán týdne<` or `cs.meeting.refresh` or `landscape:max-w-3xl`, and `getWeekPlanFn` was not called. A static render runs no effects, so the call check pins only the render path. `shouldLoad` (Task 1) pins the effect's condition.
  - `the existing "renders the meeting, not the placeholder"` also asserts no `landscape:max-w-3xl`.
  - (Wrong actor) `beforeLoad` with `weekPlan` on: a taker is redirected to his landing page, the admin to `/sprava`, and a giver stays. `screenGuard.test.ts` has no Schůzka case today. Mock `redirect` to return `{ redirect: to }`, as `planPage.test.tsx` does.
- [ ] **Step 2: Run** `pnpm test src/components/meeting/schuzkaPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the component change.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS. `src/routeTree.gen.ts` does not change.
- [ ] **Step 5: Commit** `Pass the week plan switch to Schůzka`.

### Task 4: E2E: Táta settles, sees the new week, a brother reserves, Obnovit shows it

**Suite: its own row**, not an extension of `week-plan`. The case settles the week for good, which changes the period and the copies that `week-plan.spec.ts`'s serial tests rely on. It also needs the `meeting` switch, which `plantable` does not turn on. One more server is cheaper than making #258's spec depend on test order across a settlement.

**Files:**
- Modify: `src/server/demo/seeds.ts`: add `planmeeting: { pieces: [planTable], features: ['recurring', 'week', 'meeting', 'weekPlan'] }`, with a doc line. `settleLastDay` stays off, so the week settles mid-week. `demo` already holds `planTable`; no new piece.
- Modify: `e2e/suites.ts`: `{ name: 'meeting-plan', spec: 'meeting-plan.spec.ts', seed: 'planmeeting' }`, with the comment "settles the week for good, so its own server".
- Create: `e2e/meeting-plan.spec.ts`
- Modify: `e2e/meeting.spec.ts` (switch-off check)
- Modify, if it lists seeds one by one: `src/server/demo/suites.test.ts`. Add a `planmeeting` case: `meeting` and `weekPlan` on, `settleLastDay` off, Starší's "Zalít kytky na balkoně" waiting.

Seed facts (from `planTable`, no week running): the week started yesterday 00:00, Starší's "Zalít kytky na balkoně" for today waits for approval, and "Prostřít stůl k večeři" is free every day. After the settle, the new week starts now, and its first "Prostřít stůl" cell is free. Cells are found by `data-day` and the chore name in `aria-label`, never by weekday.

- [ ] **Step 1: Write `e2e/meeting-plan.spec.ts`** (`PHONE` viewport, serial), one test plus helpers:
  1. Táta logs in and opens `/schuzka`. There is no `section[aria-labelledby="meeting-plan-label"]`. Record `getWeekPlanFn` requests with `page.on('request')` filtered on the server-fn path (find the id in the build's request URL once and match on it); there are none so far. He approves "Zalít kytky na balkoně", then Dál → Potvrdit vyúčtování → Vyúčtovat.
  2. Step 3: `cs.meeting.newWeek` is visible, and the plan section is visible below the `cs.meeting.planTasks` label (bounding box `y` greater). The section's week label equals the week text after `cs.meeting.newWeek` in the result card. Exactly one plan request was made.
  3. `cell = section.locator('button[aria-label^="Prostřít stůl k večeři, "]').first()`. Read `day = data-day`, and check that the label ends in `: volné`.
  4. A second context: Starší logs in, opens `/tyden/plan`, taps `button[data-day="<day>"][aria-label^="Prostřít stůl k večeři, "]`, and sees `Rezervováno: …`.
  5. Táta's cell still ends in `: volné` (no auto-refresh). He taps `Obnovit`. The label ends in `: rezervováno, Starší`, and the button is enabled again.
  6. Starší frees that cell (tap → Uvolnit sheet → Uvolnit, as `releaseOwn` in `week-plan.spec.ts`). Táta's cell still says Starší. Táta taps `Obnovit` a **second** time, and the label ends in `: volné`. Starší reserves it again.
  7. Táta taps Obnovit, then taps the cell → URL `/ukol/\d+$`.
- [ ] **Step 2: Extend `e2e/meeting.spec.ts`** (`week` seed, switch off): after settling, `section[aria-labelledby="meeting-plan-label"]` has count 0 and there is no `Obnovit` button.
- No e2e for step 3 without a settlement while the switch is on. No seed reaches that state cheaply: `planmeeting` has a running week with `settleLastDay` off, so `/schuzka` opens at step 1, and step 3 without a settlement needs either no period or the last-day rule on. Task 1's `planShown`/`shouldLoad` and Task 3's render test cover it. If the Tests judge wants it, a `family`-pieces seed with `meeting` and `weekPlan` on ("Teď není co vyúčtovat") is a 3-line addition.
- [ ] **Step 3: Run** `pnpm build && pnpm exec playwright test e2e/meeting-plan.spec.ts e2e/meeting.spec.ts`. Expected: PASS. Also run `pnpm test src/server/demo`.
- [ ] **Step 4: Commit** `Test the week plan at Schůzka end to end`.

No `e2e/keyboard.spec.ts` case: this PR adds no form or text field.

### Task 5: Screenshots and final check

- [ ] **Step 1: Take one set** (skill `pr-review-rounds` §1 code phase): iPhone 15 Pro 393×852 at `deviceScaleFactor: 3`, light, `TASKMASTER_ENV=preview` and `TASKMASTER_SEED=planmeeting`, logged in as `tata`, in one folder outside the repo:
  - `schuzka-giver-plan.png`: step 3 after the settle, scrolled to the plan block (header, hint, table with the long name "Vyluxovat celý obývák a chodbu").
  - `schuzka-giver-plan-tasks.png`: the top of step 3 (result card, open tasks) above the block.
  - `schuzka-giver-plan-loading.png`: the first load (delay the server-fn request with `page.route`).
  - `schuzka-giver-plan-busy.png`: Obnovit busy, table under it.
  - `schuzka-giver-plan-error.png`: Obnovit failed (abort the request): message plus table.
  - `schuzka-giver-plan-error-first.png`: the first load failed: message and Obnovit, no table.
  - `schuzka-giver-plan-reserved.png`: after Obnovit, Starší's avatar in the cell.
  - `schuzka-giver-plan-landscape.png`: 852×393, the whole week fits (`wide`).
  - `schuzka-giver-plan-360.png`: 360×800, the block with the long name. The header wraps, Obnovit stays whole, and the name is clamped at three lines as on Týden.
  - `schuzka-giver-plan-off.png`: seed `week` (switch off): step 3 as before.
  - The empty states are #258's and appear unchanged inside the block. The static test covers them; the brief says so.

  Look at each one. Whatever a person needs to read or tap must be whole.
- [ ] **Step 2: Verify** (`superpowers:verification-before-completion`): `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`. All pass.

## Pre-flight checklist (pr-review-rounds §1)

Tests:
- Audit rollback: n/a. No state change; the reserve and release are #258's.
- Boundaries: n/a. No new level, limit or window. The start-day column rule is #258's, already tested.
- Wrong actor: Task 3 (taker and admin at `/schuzka` with the switch on). `getWeekPlanFn` keeps `requireRole('giver','taker')`.
- Real entry point: Task 4 e2e through `/schuzka`. Task 3 renders the route's component.
- Server function shape: no new server function. `weekPlanHandler`'s shape is pinned in `weekPlan.test.ts` (#258).

UX:
- 44 px: Obnovit uses the default `Button` size (`min-h-tap`, Task 2 test). The table cells are #258's (`min-h-tap`).
- motion-reduce: the spinner has `motion-reduce:animate-none`. No other new motion.
- Busy / error / retry: Task 2 covers the first load and Obnovit (busy line or busy button, Czech message, Obnovit retries).
- Empty and error states: #258's empty states inside the block (Task 2). `feature_off` hides the block.
- Irreversible action: none new. The settlement confirm is unchanged.
- Long Czech name at 360 px: Task 2 layout notes and the `-360` screenshot. The header wraps, the button stays whole, and the name is clamped at three lines (full name in the cell label).
