# Task page: Hotovo and Uvolnit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#150 Task page: Hotovo and Uvolnit for the brother who has the task](https://github.com/SlatinskyJ/taskmaster/issues/150)

**Goal:** The brother who reserved a task sees "Hotovo" and "Uvolnit" on its page `/ukol/<id>`, doing exactly what the same buttons on his Domů "Moje" row do.

**Architecture:** Screens only. The two buttons move out of `TakerBoard` into one presentational component, `WorkButtons`, that both the Domů row and the task page render. Who sees them is one pure helper in `taskView.ts`. The server functions (`completeTaskFn`, `releaseTaskFn`, #35) are unchanged and keep checking the actor themselves.

**Tech Stack:** TanStack Start (React, TS), Tailwind v4, vitest static render (`renderToStaticMarkup`).

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.4 (reserve, release), §5.5 (done); UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §7.1 TTask ("accept, counter, reserve, done, release").

**Base:** stacked on [#145 Bidding on one-time tasks: screens](https://github.com/SlatinskyJ/taskmaster/pull/145) (branch `34-bidding-screens`), which adds the task page. Rebases onto `main` once #145 merges.

**Size:** about 80 changed lines outside tests (WorkButtons ~45, TakerBoard −35/+10, page ~5, taskView ~8, demo seed ~10).

## Global Constraints

- Czech UI text only in `src/lib/strings.ts`. This PR adds **no** new strings: it reuses `cs.work.done` ("Hotovo"), `cs.work.release` ("Uvolnit"), `cs.work.toast.done`, `cs.work.toast.pending`, `cs.work.toast.released`.
- Every tap target ≥ 44 px (`Button` already has `min-h-tap`).
- No change to server functions, domain, DB, audit.

## Decisions

1. **Same behaviour as Domů, no dialog.** Domů's Hotovo and Uvolnit have no confirm today; the page copies them exactly (issue: "using the same actions as his Domů row"). If a judge wants a confirm on Uvolnit (a bid-won task goes back to negotiation, spec §5.4), it is a `follow-up` for both places, not this PR.
2. **Scope = the reserver only.** Rezervovat for an open task, "done without reserving" (§5.5) and the parent's GTask buttons are not in #150. Domů keeps Rezervovat; #40 builds the rest.
3. **Placement:** directly under the state card, before the bid thread, so the buttons are visible without scrolling past a long thread. BidPanel (proposed tasks only) stays at the bottom; the two never show together (BidPanel renders nothing unless `status === 'proposed'`).
4. **Layout on the page:** Hotovo is the main action, as the TTask mockup draws it: full width (`ok`, `w-full`), with Uvolnit full width under it (`ghost`, `w-full`), in `grid gap-2`. On the row: unchanged, Uvolnit then Hotovo in `flex gap-1.5`.
5. **Busy state:** the page has its own `useTaskAction()`; the row keeps sharing the board's one `useTaskAction()` so tapping one row still disables every button on the board (today's behaviour). Hence `WorkButtons` takes `busy` and `run` as props instead of calling the hook.

## UX pre-flight

- Taps: `Button` has `min-h-tap`; page buttons `w-full`, stacked in `grid gap-2`. ✓
- Motion: confetti already respects reduced motion (`burstConfetti`); no new animation.
- Busy/error: `run` disables both buttons and sets `aria-busy` on the tapped one; failure → Czech toast from `taskErrorMessage` + `router.invalidate()` (buttons come back, tap again). Uvolnit gains `aria-busy` too (row and page).
- Loader states: unchanged (page loader already throws notFound).
- Irreversible: see Decision 1.
- 360 px with a long name: the name is the page title (Screen header, already wraps). Buttons hold only "Hotovo"/"Uvolnit", each the full ~328 px: whole, nothing cut. Screenshot check: Hotovo reads as the main action.

## Tests pre-flight

- Audit rollback: no new state change (server untouched; #35 tests cover it).
- Wrong actor: `canWorkOn` is false for another brother, a parent, an admin; the page then renders no buttons. The server still refuses a wrong actor (existing `lifecycle.test.ts`).
- Boundary: status `reserved` only; `open`, `proposed`, `done_unconfirmed`, `confirmed` → no buttons.
- Real entry point: the route component itself is rendered in a test (Task 3, `taskPage.test.tsx`), so leaving out `TaskWorkPanel` or ungating it fails. Screenshots from the real preview build cover the running app.
- Return shape: no server function changes.

## Review Focus

1. Brother B opens brother A's reserved task → sees "Rezervoval A", no buttons. (Task 1 test.)
2. Parent opens a reserved task → no taker buttons. (Task 1 test.)
3. Stale page: A released on Domů in another tab, then taps Hotovo on the page → server refuses, Czech toast, page reloads to the new state. Relies on the existing `useTaskAction` failure path, unchanged here; covered by reading only, no test in this PR.
4. Hotovo on a task that needs no approval → toast "Hotovo!", else the pending toast. (Task 2 test via the success callback.)
5. Domů row unchanged after the refactor: same labels, order, disabled while busy. (Task 3 test.)

---

### Task 1: `canWorkOn` helper

**Files:**
- Modify: `src/components/tasks/taskView.ts`
- Test: `src/components/tasks/taskView.test.ts`

**Interfaces:**
- Produces: `export function canWorkOn(task: Pick<TaskView, 'status' | 'reservedBy'>, me: Me): boolean`

- [ ] **Step 1: failing test** `it('Hotovo and Uvolnit only for the brother who reserved it')`:
  ```ts
  const mine = view({ status: 'reserved', reservedBy: { id: 3, name: 'Starší' } })
  expect(canWorkOn(mine, STARSI)).toBe(true)
  expect(canWorkOn(mine, MLADSI)).toBe(false)
  expect(canWorkOn(mine, TATA)).toBe(false)
  expect(canWorkOn(mine, ADMIN)).toBe(false)
  for (const status of ['open', 'proposed', 'done_unconfirmed', 'confirmed'] as const)
    expect(canWorkOn({ ...mine, status }, STARSI)).toBe(false)
  expect(canWorkOn(view({ status: 'reserved', reservedBy: null }), STARSI)).toBe(false)
  ```
- [ ] **Step 2:** `pnpm test src/components/tasks/taskView.test.ts` → FAIL (not exported).
- [ ] **Step 3:** implement: `me.role === 'taker' && task.status === 'reserved' && task.reservedBy?.id === me.id`.
- [ ] **Step 4:** same command → PASS.
- [ ] **Step 5:** commit `Task page: who may finish or release a task`.

### Task 2: `WorkButtons` and `TaskWorkPanel`

**Files:**
- Create: `src/components/tasks/WorkButtons.tsx`
- Test: `src/components/tasks/workButtons.test.tsx`

**Interfaces:**
- Consumes: `canWorkOn` (Task 1); `useTaskAction()` → `{ busy, run }`; `completeTaskFn`, `releaseTaskFn` from `~/server/tasks/functions`.
- Produces:
  - `export function WorkButtons(props: { task: Pick<TaskView, 'id'>; busy: string | null; run: ReturnType<typeof useTaskAction>['run']; wide?: boolean }): JSX.Element` — Uvolnit (`variant="ghost"`) then Hotovo (`variant="ok"`). Keys `release-<id>` / `done-<id>`. Uvolnit: `run(key, () => releaseTaskFn({ data: { taskId } }), () => cs.work.toast.released)`. Hotovo: `run(key, () => completeTaskFn({ data: { taskId } }), r => r.status === 'confirmed' ? cs.work.toast.done : cs.work.toast.pending, { confetti: e.currentTarget })`. Both `disabled={busy !== null}`, `aria-busy={busy === key}`. `wide`: Hotovo first then Uvolnit, wrapper `grid gap-2`, both `w-full`; not wide: Uvolnit then Hotovo, wrapper `flex gap-1.5`.
  - `export function TaskWorkPanel(props: { task: TaskView; me: Me }): JSX.Element | null` — `null` unless `canWorkOn`; else its own `useTaskAction()` and `<WorkButtons wide …/>`.

- [ ] **Step 1: failing tests** (stubs as in `bidPanel.test.tsx`: `useTaskAction` → `{ busy: action.busy, run: action.run }`, Button recorder, `~/server/tasks/functions` → `{ completeTaskFn: vi.fn(), releaseTaskFn: vi.fn() }`):
  - `it('the reserver sees Hotovo, then Uvolnit under it, both full width')`: render `TaskWorkPanel` for reserved-by-3 with `STARSI` → markup has `Hotovo` before `Uvolnit`, wrapper `grid gap-2`, two `w-full`.
  - `it('nobody else sees them')`: `MLADSI`, `TATA`, and `status: 'open'` → `renderToStaticMarkup` is `''`.
  - `it('Hotovo sends this task to completeTaskFn with confetti, toast by status')`: press Hotovo → `action.run` called with `('done-1', fn, success, { confetti: <el> })`; calling `fn()` → `completeTaskFn` called with `{ data: { taskId: 1 } }`; `success({ ok: true, status: 'confirmed' })` → `'Hotovo!'`, `success({ ok: true, status: 'done_unconfirmed' })` → `cs.work.toast.pending`.
  - `it('Uvolnit sends this task to releaseTaskFn')`: key `'release-1'`, `releaseTaskFn` with `{ data: { taskId: 1 } }`, success → `cs.work.toast.released`.
  - `it('while busy both are disabled and the tapped one is aria-busy')`: `action.busy = 'release-1'` → both recorded `disabled: true`; markup has `aria-busy="true"` once.
- [ ] **Step 2:** `pnpm test src/components/tasks/workButtons.test.tsx` → FAIL (module missing).
- [ ] **Step 3:** implement per Interfaces.
- [ ] **Step 4:** same command → PASS.
- [ ] **Step 5:** commit `Task page: Hotovo and Uvolnit buttons component`.

### Task 3: Domů row uses `WorkButtons`; the page renders `TaskWorkPanel`

**Files:**
- Modify: `src/components/tasks/TakerBoard.tsx` (the reserved row's `action`, and drop the local `done` helper)
- Modify: `src/routes/_app/ukol/$taskId.tsx` (render `<TaskWorkPanel task={task} me={me} />` right after the state `Card`; comment: "Reserve stays on Domů" instead of "Reserve, done and release stay on Domů")
- Test: `src/components/tasks/workButtons.test.tsx`, Create: `src/components/tasks/taskPage.test.tsx`

- [ ] **Step 1a: failing route test** in `taskPage.test.tsx`: mock `@tanstack/react-router` so `createFileRoute(path)(opts)` returns `{ ...opts, useRouteContext: () => ({ user }), useLoaderData: () => ({ task, thread: [] }) }` (`user`/`task` from module-level variables each test sets), plus `notFound`, `Link`, `useRouter` stubs; stub `useTaskAction`, `~/server/tasks/functions`, `~/lib/screenGuard`. Render `Route.component` with `renderToStaticMarkup`. `it('the task page shows Hotovo and Uvolnit to the brother who reserved it, nobody else')`: task reserved by 3 → user Starší (3, taker) markup contains `Hotovo` and `Uvolnit`; user Mladší (4, taker) and Táta (2, giver) → neither. (Fails while the route lacks `<TaskWorkPanel/>`.)
- [ ] **Step 1b: failing test** `it('Domů Moje row keeps Uvolnit then Hotovo, compact, disabled while anything on the board runs')`: render `TakerBoard` with one reserved-by-3 task, `me=3`, `action.busy = 'reserve-9'` → markup has `Uvolnit` before `Hotovo` inside `flex gap-1.5`, both recorded `disabled: true`, and Uvolnit's onClick calls `run` with key `'release-1'`. (Fails until the row's Uvolnit gets `aria-busy`/the shared component: assert `aria-busy="false"` on both.) Also a second `mine` row, `done_unconfirmed` with `earnerId: 3`: it renders as the pending row with no Hotovo/Uvolnit (only one of each label in the markup).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** in `TakerBoard`, a `mine` row shows `<WorkButtons task={t} busy={busy} run={run} />` when `canWorkOn(t, { id: me, role: 'taker' })`, else the pending row (one rule for who may press, shared with the page); the `mine` filter itself stays. Add the page line.
- [ ] **Step 4:** `pnpm test src/components/tasks` → PASS; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** commit `Task page: show Hotovo and Uvolnit to the brother who has the task`.

### Task 4: demo data — a task reserved to Starší

**Files:**
- Modify: `src/server/demo/seed.ts` (after "Uklidit sklep")
- Test: `src/server/demo/seed.test.ts`

- [ ] **Step 1: failing test:** extend `'seeds a task in negotiation and a plain offer, through the real actions'` (rename to `…, a plain offer and one reserved to Starší, …`): expected list gains `['Vyluxovat celý obývák a chodbu', 'reserved', 8, []]` in `listTasks` order, and that row's `reservedBy.name` is `'Starší'`.
- [ ] **Step 2:** `pnpm test src/server/demo/seed.test.ts` → FAIL.
- [ ] **Step 3:** seed through the real actions, each via `step(...)`: `createTask(tx, id('tata'), { title: 'Vyluxovat celý obývák a chodbu', score: 8, approvalRequired: true }, now)`, `placeBid(tx, id('starsi'), task.id, 10, now)`, `acceptOffer(tx, id('starsi'), task.id, 8, now)` (a bidder's yes, "Beru za 8" → reserved to him). Import `acceptOffer` from `~/server/tasks`.
- [ ] **Step 4:** same command → PASS; then `pnpm test` (whole suite once, before the PR leaves draft).
- [ ] **Step 5:** commit `Demo data: a task reserved to Starší`.

### Task 5: verify and screenshots

- [ ] `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build` all pass.
- [ ] Preview build (`TASKMASTER_ENV=preview`), Playwright 360 px light, login `starsi`: `ukol-taker-reserved.png` (the long-name task, buttons whole), `domu-taker-moje.png` (row unchanged); login `mladsi`: `ukol-taker-someone-else.png` (no buttons); login `tata`: `ukol-giver-reserved.png` (no taker buttons).
