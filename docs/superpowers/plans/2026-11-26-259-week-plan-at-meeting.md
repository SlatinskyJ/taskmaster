# Week plan at Schůzka Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (CLAUDE.md PR flow step 3). Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#259 Show the week plan at Schůzka](https://github.com/SlatinskyJ/taskmaster/issues/259), depends on [#258](https://github.com/SlatinskyJ/taskmaster/issues/258) (merged as PR #297).

**Goal:** With the `weekPlan` switch on, Schůzka step 3 (Plan) shows #258's plan table, giver view, under the open one-time tasks, with an "Obnovit" button that refetches only the table.

**Architecture:** No server change. The Schůzka loader also calls #258's `getWeekPlanFn` when the switch is on. Step 3 renders a new `MeetingWeekPlan` block through a slot prop, so `MeetingBody` stays hook-free. The refresh logic lives in a pure module, like `createConfirm` in `meetingFlow.ts`.

**Tech Stack:** TanStack Start (route loader, server fn), React 19, Tailwind, Vitest (static markup), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.9 step 3, §5.12 ("At the meeting", "The plan table (Týden)"); UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §7.3 M3Plan.

**Size:** about 160 changed lines, not counting tests, migrations and generated files: `planRefresh.ts` ~45, `MeetingWeekPlan.tsx` ~70, `schuzka.tsx` +8, `MeetingScreen.tsx` +14, `meetingFlow.ts` +5, `functions.ts` +2, `strings.ts` +6, `seeds.ts` +3, `e2e/suites.ts` +3. This is under 300 lines, but it adds keys to the Czech strings module (`src/lib/strings.ts`), and CLAUDE.md lists that module as a protected shared module. So this is **not** a small PR, and it gets this plan and the plan rounds. Nothing else it touches is protected: no schema, domain, auth, scheduler, CI or dependency change.

## Open questions for Jakub (spec silent or unclear)

1. **Step 3 without a settlement in this visit.** §5.12 says step 3 shows "the week the settlement just started". Step 3 is also reached with no settlement: (a) before the running week's last day (#211, "Týden ještě běží"), (b) "Teď není co vyúčtovat", (c) the ended week was settled while the next one already started at its cutoff (§5.8 [call]), where `result.next` is null ("Tento týden běží dál"). The spec says nothing about which table shows there, or whether one shows at all. **The plan builds:** in every case, the table of the period running now. That is what `getWeekPlan(db, now)` returns and what Týden → Plán týdne shows. It is the coming week in (c), and the running week in (a) and (b). If Jakub prefers "only after a settlement in this visit", the change is one condition (`ui.result !== null`) in Task 2's `StepPlan` placement, plus its test. Until he answers, the PR carries `needs-jakub`.

Everything else is settled by the spec, the issue, or Jakub's wireframe decisions (table under the open tasks; "Obnovit", no auto-refresh; switch off → step 3 unchanged).

## Which week, and how it maps onto `getWeekPlan`

- `getWeekPlan(db, now)` reads `currentPeriod(db, now)`. Confirming the settlement ends the old period at that moment and starts the next (§5.8). The next one's copies exist at once (§5.12, #257). So after the confirm, the period running "now" **is** the week the settlement just started. The function needs no new input and no period id.
- The loader runs before the confirm, while steps 1 and 2 are shown, and at that point it returns the old week. `afterConfirm` already calls `router.invalidate()` after every answer (`meetingFlow.ts`). That reruns the loader, so step 3 gets the new week's table without any new code. `weekPlan.test.ts` already pins this server-side ("a meeting ends the week early on Sunday 20:00 …"). The e2e in Task 4 pins it end to end.
- Steps 1 and 2 never show the table. Only `StepPlan` renders the slot.

## Global Constraints

- UI labels in Czech, only in `src/lib/strings.ts`. Code, identifiers and commits in English.
- With `weekPlan` off: step 3 is unchanged, and the loader makes **no** `getWeekPlanFn` call.
- Giver view: `viewer = { id: user.id, role: 'giver' }`. Every cell tap opens that copy's task page (`tapAction` from #258; nothing new).
- No auto-refresh. The table changes only through a reload of the route (confirm) or through "Obnovit" (Jakub, wireframe; §5.12 [call] "updates when reloaded").
- Taps are at least 44 px (`min-h-tap` / `size-tap`). Every animation has a `motion-reduce:` opt-out.
- Component tests render static markup only. Logic goes in a plain module.
- Reuse `WeekPlanTable`, `planView.ts` and `cs.plan` from #258. Do not fork them.

## Review Focus

1. **A refresh answer that comes back after the route reloaded** (Obnovit tapped, then the loader reran) must not cover the newer loader data with the older answer. Pinned by Task 1 `drops an answer started from an older loader plan`.
2. **Obnovit tapped twice quickly** sends one request. Pinned by Task 1 `a second refresh while one is on its way does nothing`.
3. **Refresh fails (offline, 500):** the last table stays, a Czech message shows, and the button works again for a retry. Pinned by Task 1 `failed keeps the table and sets failed` and Task 2 `refresh failed: message, table still there, button enabled`.
4. **The server answers `feature_off`** (the switch went off after the app started, and launch switches load at app start) on load or on refresh. Step 3 then looks as with the switch off. Pinned by Task 2 `feature_off answer renders nothing`.
5. **No period at all, or no chore with schedule days.** #258's empty states ("Týden ještě nezačal.", "Žádný opakovaný úkol nemá pevné dny.") show inside step 3, and Obnovit still works. Pinned by Task 2 `empty plan: #258 empty state under the header`.

---

### Task 1: Refresh state (pure)

**Files:**
- Create: `src/components/meeting/planRefresh.ts`
- Modify: `src/server/instances/functions.ts` (the `PlanAnswer` type, next to `WeekPlan`)
- Test: `src/components/meeting/planRefresh.test.ts`

**Interfaces:**
- Consumes: `WeekPlan` from `~/server/instances/functions`.
- Produces, in `~/server/instances/functions` next to the `WeekPlan` re-export: `export type PlanAnswer = WeekPlan | { error: 'feature_off' }`. `weekPlanHandler` gets this return type, and nothing else changes there.
- Produces, in `planRefresh.ts` (it imports `PlanAnswer` from there):
  ```ts
  export interface RefreshState { base: PlanAnswer | null; plan: PlanAnswer | null; busy: boolean; failed: boolean }
  export const REFRESH_START: RefreshState // { base: null, plan: null, busy: false, failed: false }
  export type RefreshEvent =
    | { type: 'sending'; base: PlanAnswer }
    | { type: 'answer'; base: PlanAnswer; plan: PlanAnswer }
    | { type: 'failed'; base: PlanAnswer }
  export function refreshReduce(s: RefreshState, e: RefreshEvent): RefreshState
  /** What to draw: the refreshed plan only while it was fetched on top of the current loader plan. */
  export function refreshView(s: RefreshState, loaded: PlanAnswer): { plan: PlanAnswer; busy: boolean; failed: boolean }
  /** One call at a time (as createConfirm). `base` is the loader plan when tapped. */
  export function createRefresh(fetch: () => Promise<PlanAnswer>, dispatch: (e: RefreshEvent) => void): (base: PlanAnswer) => Promise<void>
  /**
   * The Obnovit tap, as the component wires it: always sends the **loader** plan as `base`,
   * never the plan on screen (which may be an earlier refresh's answer). The component's
   * onClick is exactly `refreshTap(refresh, loaded)`; it holds no logic of its own.
   */
  export function refreshTap(refresh: (base: PlanAnswer) => Promise<void>, loaded: PlanAnswer): () => void
  ```
  Rules: `sending` sets `busy`, clears `failed`, and keeps `plan` only if `base` is unchanged. `answer`/`failed` always clear `busy`, but set `plan`/`failed` only when `e.base === s.base`. `refreshView` returns `{ plan: loaded, busy, failed: false }` when `s.base !== loaded`, otherwise `{ plan: s.plan ?? loaded, busy, failed }`. Compare by identity (`===`): every loader run returns a new object.

- [ ] **Step 1: Write the failing tests** (fixtures: `planFixture()` from `~/components/week/fixtures`, two distinct objects `a`, `b`):
  - `before any refresh the loader plan shows`: `refreshView(REFRESH_START, a)` → `{ plan: a, busy: false, failed: false }`.
  - `an answer replaces the plan`: sending(a) then answer(a, b) → `refreshView(s, a).plan === b`, `busy` false.
  - `drops an answer started from an older loader plan`: sending(a), then the loader gives `c`, then answer(a, b) → `refreshView(s, c).plan === c`, `busy` false.
  - `a newer loader plan wins over an earlier refresh`: sending(a), answer(a, b), loader gives `c` → `refreshView(s, c).plan === c`.
  - `sending keeps plan when base is unchanged`: sending(a), answer(a, b), sending(a) → `refreshView(s, a)` is `{ plan: b, busy: true, failed: false }` (the last answer stays on screen while the next one loads). With sending(c) instead of the second sending(a) → `refreshView(s, c).plan === c`.
  - `failed keeps the table and sets failed`: sending(a), failed(a) → `{ plan: a, busy: false, failed: true }`. Then sending(a) clears `failed`.
  - `a second refresh while one is on its way does nothing`: `createRefresh` with a fetch that returns a pending promise, called twice → fetch called once and `sending` dispatched once. After it resolves, a third call fetches again.
  - `a thrown fetch dispatches failed, and the next call fetches again`: fetch rejects → events `[sending, failed]`, no throw out of the returned function. A second call then calls fetch again (call count 2) and, if it resolves with `b`, dispatches `[sending, answer(a, b)]`. The in-flight flag is cleared in `finally`.
  - `two consecutive taps: the second tap's answer shows`: run the real wiring with a reducer. Hold `state` in a variable, `dispatch = (e) => { state = refreshReduce(state, e) }`, `refresh = createRefresh(fetch, dispatch)`, and a fetch that resolves `b`, then `c`. `await` `refreshTap(refresh, a)()` (flush the promise), then do it a second time with the same `loaded = a` → `refreshView(state, a).plan === c` and `busy` false. The variant where the second tap passes the plan on screen (`b`) as `loaded` must be impossible by the API, so the test only uses `refreshTap(refresh, a)`.
- [ ] **Step 2: Run** `pnpm test src/components/meeting/planRefresh.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `PlanAnswer` in `functions.ts` and `planRefresh.ts` with the signatures above. Use an in-flight flag in the closure, as in `createConfirm`, cleared in `finally`.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `pnpm mutation --mutate src/components/meeting/planRefresh.ts` and kill the surviving mutants with assertions, not by loosening code.
- [ ] **Step 5: Commit** `Add the refresh state for the meeting's plan table` (`planRefresh.ts`, its test, `functions.ts`).

### Task 2: The plan block in step 3

**Files:**
- Create: `src/components/meeting/MeetingWeekPlan.tsx`
- Modify: `src/components/meeting/MeetingScreen.tsx` (props of `MeetingScreen`, `MeetingBody`, `StepPlan`; placement; `frame`)
- Modify: `src/components/meeting/meetingFlow.ts` (`planShown`)
- Modify: `src/lib/strings.ts` (`cs.meeting`)
- Test: `src/components/meeting/meetingWeekPlan.test.tsx`, `src/components/meeting/meeting.test.tsx`, `src/components/meeting/meetingFlow.test.ts`

**Interfaces:**
- Consumes: Task 1. `WeekPlanTable` (`plan`, `viewer`) from `~/components/week/WeekPlanTable`. `weekLabel` from `~/components/period/periodView`. `getWeekPlanFn` from `~/server/instances/functions`.
- Produces:
  ```ts
  /** Hook-free drawing: header, hint, message, table. */
  export function MeetingWeekPlanView(props: { plan: PlanAnswer; busy: boolean; failed: boolean; viewerId: number; onRefresh: () => void }): ReactNode
  /** With state: useReducer(refreshReduce, REFRESH_START), createRefresh(() => getWeekPlanFn(), dispatch) in useMemo, onRefresh = refreshTap(refresh, loaded). */
  export function MeetingWeekPlan(props: { loaded: PlanAnswer; viewerId: number }): ReactNode
  ```
  `MeetingBody` gets `weekPlan?: ReactNode` (default none) and passes it to `StepPlan`. It stays hook-free. `MeetingScreen` gets:
  - `weekPlan?: PlanAnswer | null` and `viewerId: number`. It builds `<MeetingWeekPlan loaded={weekPlan} viewerId={viewerId} />` only when `planShown` is true, and passes it to `MeetingBody`.
  - `frame?: (body: ReactNode, wide: boolean) => ReactNode` (default `(body) => body`). It returns `frame(<MeetingBody … />, planShown(stepOf(meeting, ui), weekPlan))`, so the route's `Screen` is `wide` only while step 3 shows the table.

  `planShown` lives in `meetingFlow.ts`: `export function planShown(step: MeetingStep, weekPlan: PlanAnswer | null | undefined): boolean`, true only for `step === 3` and a loader answer that is a `WeekPlan` (not `null`, not `{ error: 'feature_off' }`). `wide` follows the loader answer. If a later Obnovit answers `feature_off` (the switch went off mid-meeting), the block hides and the Screen stays wide until the next reload. That is accepted as harmless and noted in the brief. `StepPlan` renders it **after** the open-tasks list (or its empty state) and **before** the "+ Nový úkol" / "Ukončit schůzku" buttons.
- Strings (`cs.meeting`): `refresh: 'Obnovit'`, `planHint: 'Kluci si dny rezervují v Týdnu na svých telefonech. Pak klepni na Obnovit.'`, `refreshFailed: 'Plán se nepodařilo načíst. Zkus to znovu.'`. The section title reuses `cs.plan.title` ("Plán týdne").

Layout (360 px, long names). `<section aria-labelledby="meeting-plan-label">`:
- A header row `flex flex-wrap items-center justify-between gap-2`. `SectionLabel id="meeting-plan-label"` ("Plán týdne") and, when `plan.period` exists, the week (`weekLabel(startsAt, cutoffAt)`, `num text-meta text-muted`) sit in a `min-w-0` box that wraps. The Obnovit `Button variant="ghost"` (default size → `min-h-tap`) is `shrink-0` and always stays whole. It has a `RefreshCw` icon with `animate-spin motion-reduce:animate-none` while busy, `disabled` and `aria-busy` while busy, and keeps its label.
- The hint below it (`text-meta text-muted`, wraps).
- When failed: `<p role="alert" className="text-meta font-bold text-destructive break-words">`. Obnovit is the retry.
- `WeekPlanTable plan={plan} viewer={{ id: viewerId, role: 'giver' }}`. Long chore names are #258's (pinned column, `line-clamp-3`, full name in each cell's `aria-label`). Nothing new is cut.
- `plan` is `{ error: 'feature_off' }` → render `null` (whole block, header included).

- [ ] **Step 1: Write the failing tests** in `meetingWeekPlan.test.tsx`. Mock `@tanstack/react-router` (`useRouter` with `navigate`, `invalidate`) and `~/server/tasks/functions` as `planPage.test.tsx` does. Render `MeetingWeekPlanView` statically:
  - `header, week, hint and a giver table`: html contains `>Plán týdne<`, `29. 11. – 6. 12.` (from `planFixture`), `cs.meeting.planHint`, `cs.meeting.refresh`, `aria-label="Prostřít stůl k večeři, St: volné"` (the giver label, no "rezervovat"), and does not contain `cs.plan.tapHint`.
  - `busy: Obnovit disabled, aria-busy, spinner has motion-reduce`: contains `aria-busy="true"`, `disabled`, `motion-reduce:animate-none`.
  - `refresh failed: message, table still there, button enabled`: contains `role="alert"` and `cs.meeting.refreshFailed`, contains `data-slot="plan-days"`, and the Obnovit button is not disabled.
  - `feature_off answer renders nothing`: `renderToStaticMarkup(...) === ''`.
  - `empty plan: #258 empty state under the header`: `planFixture({ period: null, days: [], rows: [] })` → contains `cs.week.noPeriod` and `cs.meeting.refresh`. With `rows: []` → `cs.plan.noRows`.
  - `tap targets`: the Obnovit button's markup has `min-h-tap`.
- [ ] **Step 2: Add to `meeting.test.tsx`** (same file, existing mocks) and `meetingFlow.test.ts`:
  - `planShown`: `planShown(3, planFixture())` is true. It is false for `(1, plan)`, `(2, plan)`, `(3, null)`, `(3, undefined)` and `(3, { error: 'feature_off' })`.
  - `step 3 renders the weekPlan slot after the open tasks and before Ukončit schůzku`: `MeetingBody` with `weekPlan={<div data-testid="slot" />}` at step 3 → `html.indexOf('data-testid="slot"')` is greater than the index of `cs.meeting.planTasks` and less than the index of `cs.meeting.end`.
  - `steps 1 and 2 never render the slot`: `pendingWeek()` at step 1 and at step 2 → no `data-testid="slot"`.
  - `no slot: step 3 unchanged`: the existing step 3 assertions pass with `weekPlan` left out (no change to the old tests).
- [ ] **Step 3: Run** `pnpm test src/components/meeting`. Expected: the new cases FAIL.
- [ ] **Step 4: Implement** the strings, `MeetingWeekPlan.tsx`, and the slot in `MeetingScreen.tsx`. `MeetingWeekPlan` draws `refreshView(state, loaded)` and passes `onRefresh={refreshTap(refresh, loaded)}`, with no other tap logic in the component.
- [ ] **Step 5: Run** `pnpm test src/components/meeting && pnpm typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 6: Commit** `Show the week plan table in the meeting's step 3`.

### Task 3: The route: load the table when the switch is on

**Files:**
- Modify: `src/routes/_app/schuzka.tsx`
- Test: `src/components/meeting/schuzkaPage.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`MeetingScreen`'s `weekPlan`, `viewerId` and `frame` props). `getWeekPlanFn`.
- Produces: the loader returns `{ meeting, plan, weekPlan: PlanAnswer | null }`. `null` means the switch is off and no call was made.

Change: `loader: async ({ context }) => ({ meeting: await getMeetingFn(), plan: await listPlanTasksFn(), weekPlan: context.features.weekPlan ? await getWeekPlanFn() : null })`. This is the same pattern as `/tyden`'s card. The component renders `<MeetingScreen … weekPlan={weekPlan} viewerId={user.id} frame={(body, wide) => <Screen title={cs.nav.meeting} user={user} wide={wide}>{body}</Screen>} />`. So a phone held sideways fits the week (as `/tyden/plan`) only while step 3 shows the table. In steps 1 and 2, with the switch off, or on a `feature_off` answer, the Screen stays narrow. The loader error path is unchanged (`RouteError`).

- [ ] **Step 1: Update and extend the tests.** Mock `~/server/instances/functions` (`getWeekPlanFn: vi.fn(() => Promise.resolve('week'))`) and `~/server/tasks/functions` (add `reserveTaskFn`, `releaseTaskFn`).
  - `the loader asks for the meeting and the plan tasks` becomes `with weekPlan off the loader asks for the meeting and the plan tasks only`: `loader({ context: { features: { weekPlan: false } } })` → `{ meeting: 'meeting', plan: 'plan', weekPlan: null }`, and `getWeekPlanFn` is not called.
  - `with weekPlan on the loader also asks for the week plan`: → `weekPlan: 'week'`, `getWeekPlanFn` called once.
  - `renders the meeting with the table at step 3 when weekPlan is loaded`: `page.data = { meeting: settled step-3 fixture (no period), plan: [], weekPlan: planFixture() }` → contains `>Plán týdne<`, `cs.meeting.refresh` and `landscape:max-w-3xl`.
  - `step 1 with weekPlan loaded: narrow, no table`: `page.data = { meeting: pendingWeek(), plan: [], weekPlan: planFixture() }` → no `landscape:max-w-3xl`, no `cs.meeting.refresh`.
  - `feature_off answer: step 3 narrow and unchanged`: step-3 fixture with `weekPlan: { error: 'feature_off' }` → no `landscape:max-w-3xl`, no `cs.meeting.refresh`.
  - `the existing "renders the meeting, not the placeholder"` gets `weekPlan: null` and also asserts no `landscape:max-w-3xl` and no `cs.meeting.refresh`.
  - (Wrong actor) `beforeLoad` with `weekPlan` on: a taker is redirected to his landing page and the admin to `/sprava`, a giver stays (`screenGuard.test.ts` has no Schůzka case today; mock `redirect` to return `{ redirect: to }` as `planPage.test.tsx` does).
- [ ] **Step 2: Run** `pnpm test src/components/meeting/schuzkaPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the loader and component change.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS. `src/routeTree.gen.ts` does not change (same route).
- [ ] **Step 5: Commit** `Load the week plan at Schůzka with the switch on`.

### Task 4: E2E: Táta settles, sees the new week, a brother reserves, Obnovit shows it

**Suite: its own row**, not an extension of `week-plan`. Reason: the case settles the week for good, which changes the period and the copies that `week-plan.spec.ts`'s serial tests rely on. It also needs the `meeting` switch, which the `plantable` seed does not turn on. One more server is cheaper than making #258's spec depend on test order across a settlement.

**Files:**
- Modify: `src/server/demo/seeds.ts`: add `planmeeting: { pieces: [planTable], features: ['recurring', 'week', 'meeting', 'weekPlan'] }`, with a doc line. `settleLastDay` stays off, so the week settles mid-week. The demo seed already holds `planTable`; no new piece.
- Modify: `e2e/suites.ts`: `{ name: 'meeting-plan', spec: 'meeting-plan.spec.ts', seed: 'planmeeting' }`, with a comment "settles the week for good, so its own server".
- Create: `e2e/meeting-plan.spec.ts`
- Modify: `e2e/meeting.spec.ts` (switch-off check)
- Modify if it lists seeds or suites one by one: `src/server/demo/suites.test.ts` (add a `planmeeting` case: the meeting switch and weekPlan on, settleLastDay off, Starší's "Zalít kytky na balkoně" waiting).

Seed facts (from `planTable`, no week running): the week started yesterday 00:00, Starší's today's "Zalít kytky na balkoně" waits for approval, and "Prostřít stůl k večeři" is free every day. After the settle, the new week starts now. Its first "Prostřít stůl" cell is free. Cells are found by `data-day` and the chore name in `aria-label`, never by weekday.

- [ ] **Step 1: Write `e2e/meeting-plan.spec.ts`** (`PHONE` viewport, serial), one test plus helpers:
  1. Táta logs in and opens `/schuzka`. Step 1 shows no `[data-slot="plan-days"]`. He approves "Zalít kytky na balkoně", then Dál → Potvrdit vyúčtování → Vyúčtovat.
  2. Step 3: `cs.meeting.newWeek` is visible, and `section[aria-labelledby="meeting-plan-label"]` is visible, under the `cs.meeting.planTasks` label (bounding box `y` greater). The week label in that section equals the text after `cs.meeting.newWeek` in the result card.
  3. `cell = section.locator('button[aria-label^="Prostřít stůl k večeři, "]').first()`. Read `day = data-day` and assert the label ends in `: volné`.
  4. A second context: Starší logs in, opens `/tyden/plan`, taps `button[data-day="<day>"][aria-label^="Prostřít stůl k večeři, "]`, and sees `Rezervováno: …`.
  5. Táta's page: the cell still ends in `: volné` (no auto-refresh). He taps `Obnovit`, and the cell's label ends in `: rezervováno, Starší`. The button is enabled again.
  5b. A second round: Starší frees that cell on `/tyden/plan` (tap → Uvolnit sheet → Uvolnit, as `releaseOwn` in `week-plan.spec.ts`). Táta's cell still says `: rezervováno, Starší`. Táta taps `Obnovit` a **second** time, and the cell's label ends in `: volné` again. Then Starší reserves it once more so step 6 opens a reserved copy.
  6. Táta taps the cell → URL `/ukol/\d+$`.
- [ ] **Step 2: Extend `e2e/meeting.spec.ts`** (`week` seed, switch off): after settling, assert `page.locator('[data-slot="plan-days"]')` has count 0 and there is no `Obnovit` button.
- [ ] **Step 3: Run** `pnpm build && pnpm exec playwright test e2e/meeting-plan.spec.ts e2e/meeting.spec.ts`. Expected: PASS. Also run `pnpm test src/server/demo`.
- [ ] **Step 4: Commit** `Test the week plan at Schůzka end to end`.

No `e2e/keyboard.spec.ts` case: this PR adds no form or text field.

### Task 5: Screenshots and final check

- [ ] **Step 1: Take one set** (skill `pr-review-rounds` §1 code phase): iPhone 15 Pro 393×852 at `deviceScaleFactor: 3`, light, `TASKMASTER_ENV=preview` with `TASKMASTER_SEED=planmeeting`, logged in as `tata`, in one folder outside the repo:
  - `schuzka-giver-plan.png`: step 3 after the settle, scrolled to the plan block (header, hint, table with the long name "Vyluxovat celý obývák a chodbu").
  - `schuzka-giver-plan-tasks.png`: the top of step 3 (result card and open tasks) above the plan block.
  - `schuzka-giver-plan-busy.png`: Obnovit busy (delay the server-fn request with `page.route('**/_serverFn/**', …)`).
  - `schuzka-giver-plan-error.png`: Obnovit failed (abort that request): message plus table.
  - `schuzka-giver-plan-reserved.png`: after Obnovit, Starší's avatar in the cell.
  - `schuzka-giver-plan-empty.png`: seed `week` with `weekPlan` turned on in a scratch run, or the `demo` seed before any chore has schedule days if one exists. Otherwise the static test covers it. Say which in the brief.
  - `schuzka-giver-plan-landscape.png`: 852×393, the whole week fits (`wide`).
  - `schuzka-giver-plan-360.png`: 360×800, the plan block with the long name: the header wraps, Obnovit stays whole, and the name is clamped at three lines as on Týden.
  - `schuzka-giver-plan-off.png`: seed `week` (switch off): step 3 as before.

  Look at each one. Whatever a person needs to read or tap must be whole.
- [ ] **Step 2: Verify** (`superpowers:verification-before-completion`): `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`. All pass.

## Pre-flight checklist (pr-review-rounds §1)

Tests:
- Audit rollback: n/a. No state change; the reserve and release are #258's.
- Boundaries: n/a. No new level, limit or window. The start-day column rule is #258's, already tested.
- Wrong actor: Task 3 (taker and admin at `/schuzka` with the switch on). `getWeekPlanFn` keeps `requireRole('giver','taker')`.
- Real entry point: Task 4 e2e through `/schuzka`. Task 3 runs the route's loader and component.
- Server function shape: no new server function. `weekPlanHandler`'s shape is pinned in `weekPlan.test.ts` (#258).

UX:
- 44 px: Obnovit uses the default `Button` size (`min-h-tap`, Task 2 test). The table cells are #258's (`min-h-tap`).
- motion-reduce: the spinner has `motion-reduce:animate-none`. No other new motion.
- Busy / error / retry: Task 2 (busy, failed message, Obnovit retries). An initial load failure goes to the route's existing `RouteError` with "Zkusit znovu".
- Empty and error states: #258's empty states inside the block (Task 2). `feature_off` hides the block.
- Irreversible action: none new. The settlement confirm is unchanged.
- Long Czech name at 360 px: Task 2 layout notes and the `-360` screenshot. The header wraps, the button stays whole, and the name is clamped at three lines (full name in the cell label).
