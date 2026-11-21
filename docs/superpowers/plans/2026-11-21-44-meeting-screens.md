# Weekly meeting screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The giver runs the weekly meeting on `/schuzka` in three steps (Schválit, Vyúčtovat, Plánovat) on top of the server part (PR #168).

**Architecture:** One route, `src/routes/_app/schuzka.tsx`, loads `getMeetingFn()` and the giver's task list, and renders a `Meeting` component in `src/components/meeting/`. The step is client state derived from the loader data: step 1 while pending items exist, step 2 once empty, step 3 after a confirm (from the confirm's response, kept in state) or when there is nothing to settle. No new server rule; one new read (`listPlanTasks`) for step 3.

**Tech Stack:** TanStack Start/Router, React, Tailwind v4 + shadcn/ui (Hřiště theme), Vitest + Testing Library, Playwright for screenshots.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.9 (steps 1–3), §5.8; UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §7.3 (M1Pending, M2Settle, M3Plan) and the mockups on the Screens artifact (https://claude.ai/artifact/EGVWwxgLQC5cAbQ9XR185x, artboards M1Pending, M2Settle, M3Plan).

## Global Constraints

- UI labels Czech, only in `src/lib/strings.ts`. Code English.
- Giver only: the route keeps `guardScreen(role, '/schuzka')`; server functions are already giver-only.
- 360 px wide screens work; touch targets ≥ 44 px; light and dark theme tokens only (no literal colours).
- Dates through `src/domain/dates.ts` / `src/lib/formatDate.ts` (Prague wall time).
- Never a production host name anywhere.
- If [#163](https://github.com/SlatinskyJ/taskmaster/pull/163) (`src/lib/features.ts`) is on the base when building: set `meeting: true`. If not: nothing to flip (the tab is visible on this base); the brief tells Jakub that #163's switch must then be flipped by whichever lands second, noted on #163.
- Carry over from #168 review: a `settlePeriod` test with non-default defaults that checks `result.next` (length 14 days → next cutoff two Sundays out).

## Rulings (spec silent; in the brief)

1. **Confirm needs a second tap.** "Potvrdit vyúčtování" opens an in-page dialog ("Vyúčtovat týden? Je to konečné, opravit ho může jen správce." · Zpět / Vyúčtovat). Settlements are final, like "Hotovo bez bodů", which also confirms.
2. **After a confirm the screen stays on step 3** (from the response, in component state) and never leads back into step 2, even though the next week can be settled a moment later (§5.8 allows it; Rules nit on #168). Leaving and reopening `/schuzka` later shows step 2 for the new week again, as the spec allows, with its (small) totals.
3. **Nothing to settle** (`period: null`): the screen shows "Teď není co vyúčtovat" and step 3 only.
4. **Refusals** map to Czech toasts and reload: `totals_changed` "Mezitím se změnily body. Zkontroluj je a potvrď znovu.", `pending_items` back to step 1, `already_settled`/`wrong_period`/`nothing_to_settle` "Týden už je vyúčtovaný.", the rest a generic error.
5. **Step 3 lists** the coming week's tasks that still need something: proposed, open and reserved one-time tasks, newest first, with their state chip and score (as M3Plan); plus "+ Nový úkol" (to `/ukoly/novy`) and "Ukončit schůzku" (to Domů). No "Jiné hranice" button: per-period proposals are #43.

## Review Focus

1. **Pending item approved on step 1 then step 2 shows fresh totals.** After the last approval the loader reloads and step 2 totals include it. → Task 3 test `approving the last pending item unlocks step 2 with fresh totals`.
2. **A total changed while step 2 was open.** Confirm → `totals_changed` toast, reload, new totals shown, still on step 2. → Task 3 test `totals_changed reloads and stays on step 2`.
3. **Late meeting (Monday) for last week.** Header shows last week's dates and its end, not now. → Task 2 test `week label for an ended week uses its end`.
4. **Double tap on Vyúčtovat.** The button is disabled while the call runs; one call only. → Task 3 test `confirm runs once`.
5. **Long names at 360 px** ("Vyluxovat celý obývák a chodbu"), three takers. → screenshots at 360 and 390 px.

---

### Task 1: Server: tasks for step 3, and the carried-over test

**Files:**
- Modify: `src/server/tasks/tasks.ts` (add `listPlanTasks`), `src/server/tasks/functions.ts` (add `listPlanTasksFn`, GET, `requireRole('giver')`), `tests/server-fn-guards.test.ts` (`listPlanTasksFn: 'giver'`)
- Modify: `src/server/settlement/meeting.test.ts` (non-default defaults test)
- Test: `src/server/tasks/tasks.test.ts`

**Interfaces:**
- Produces: `listPlanTasks(db: Db | Tx): TaskView[]` — status in `proposed | open | reserved`, newest first. `listPlanTasksFn(): Promise<TaskView[]>`.

- [ ] Tests: `listPlanTasks lists proposed, open and reserved tasks, newest first` (a done, confirmed and cancelled task left out); meeting test `settling ends the week with the defaults passed in` (defaults `{ lengthDays: 14, … }` → `result.next.cutoffAt` = the Sunday 23:59 nearest start + 14 days).
- [ ] Run → FAIL; implement; run → PASS; commit `"Tasks for the meeting's plan step"`.

### Task 2: Meeting view helpers and strings

**Files:**
- Create: `src/components/meeting/meetingView.ts`, test `src/components/meeting/meetingView.test.ts`
- Modify: `src/lib/strings.ts` (`cs.meeting`)

**Interfaces:**
- Produces:
  - `weekLabel(startsAt: string, endsAt: string): string` → `"22. 11. – 29. 11."` (Prague days, no year).
  - `levelLabel(level: Level): string` → `Horní hranice` / `Spodní hranice` / `Bez kapesného`.
  - `shortfall(total: number, lower: number): string | null` → for level none with total > 0: `"Chyběly 3 body. Nic nepropadá, všech 47 jde do dalšího týdne."` (plural forms via `plural`), else null.
  - `settleErrorMessage(error: SettleError): string` (Ruling 4).
- Strings `cs.meeting`: `title` (existing `cs.nav.meeting`), `steps: ['Schválit', 'Vyúčtovat', 'Plánovat']`, `pendingHint: 'Hotová práce do konce týdne. Dokud tu něco zbývá, nejde vyúčtovat.'`, `allClear: 'Vše vyřízeno'`, `allClearHint: 'Můžeš vyúčtovat týden.'`, `next: 'Dál: vyúčtovat'`, `left: (n) => 'Zbývá schválit: n'`, `levels: 'hranice'`, `total: 'Celkem'`, `deducted: 'Odečte se'`, `carry: 'Převádí se'`, `final: 'Vyúčtování je konečné. Opravit ho může jen správce.'`, `confirm: 'Potvrdit vyúčtování'`, dialog `confirmTitle: 'Vyúčtovat týden?'`, `confirmYes: 'Vyúčtovat'`, `settledAt: 'Vyúčtováno'`, `newWeek: 'Nový týden'`, `startWith: 'Začínají s'`, `planTasks: 'Úkoly na tento týden'`, `newTask: '+ Nový úkol'`, `end: 'Ukončit schůzku'`, `nothing: 'Teď není co vyúčtovat'`, `toast.settled: 'Týden je vyúčtovaný'`, the error texts.

- [ ] Tests: `weekLabel` for P1 (22. 11. – 29. 11.), `week label for an ended week uses its end` (ended early at Sun 20:00 → same day), across a month end (29. 11. – 6. 12.); `levelLabel` all three; `shortfall` 47 of 50 → 3 body / 49 of 50 → 1 bod / 0 → null / lower reached → null; every `SettleError` maps to a non-empty string.
- [ ] Run → FAIL; implement; run → PASS; commit `"Meeting labels and helpers"`.

### Task 3: Meeting screen

**Files:**
- Create: `src/components/meeting/Meeting.tsx` (steps bar, step 1 = existing `ToApprove` with the hint, step 2 = a card per taker with `PointsBar` (confirmed = total, pending 0), level badge, three numbers, shortfall line; final note; confirm button + dialog; step 3 = new week card, plan tasks with `TaskRow`, buttons), `src/components/meeting/meeting.test.tsx`
- Modify: `src/routes/_app/schuzka.tsx` (loader: `getMeetingFn()` and `listPlanTasksFn()`; render `Meeting`)
- Modify: `src/lib/features.ts` only if present (Global Constraints)

**Interfaces:**
- Consumes: `getMeetingFn`, `settlePeriodFn`, `SettleResult`, `Meeting` (#168), `listPlanTasksFn`, `ToApprove`, `TaskRow`, `PointsBar`, `Dialog`, `Button`.
- Produces: `Meeting({ meeting, plan }: { meeting: Meeting; plan: TaskView[] })`.
- Confirm sends `{ periodId, shown: takers.map(t => ({ takerId: t.id, total: t.total })) }`; on success keeps `{ records, nextPeriodId }` in state and shows step 3 with "Vyúčtováno · <day time>", the new week (dates from the reloaded meeting or "Nový týden"), and "Začínají s" each taker's carry-over.

- [ ] Tests (Testing Library, mocked server functions as in `homePage.test.tsx`):
  - `pending items show step 1 and lock step 2` (button "Zbývá schválit: 2" disabled)
  - `approving the last pending item unlocks step 2 with fresh totals` (rerender with new props → "Dál: vyúčtovat" → step 2 shows 130 / −100 / 30)
  - `step 2 shows each taker's total, level, deduction and carry-over` (Starší 130 Horní hranice −100 30; Mladší 47 Bez kapesného 0 47 + "Chyběly 3 body…")
  - `confirm asks first, then settles with the shown totals` (dialog; Zpět sends nothing; Vyúčtovat calls `settlePeriodFn` with `{ periodId, shown }`)
  - `confirm runs once` (double click → one call; button disabled while busy)
  - `after a confirm the screen shows step 3 and never step 2` (even after rerender with a meeting for the new week)
  - `totals_changed reloads and stays on step 2` (toast text, `router.invalidate` called)
  - `nothing to settle shows step 3 only`
  - `step 3 lists the plan tasks and links to new task and home`
- [ ] Run → FAIL; implement; run → PASS; commit `"Meeting screen: approve, settle, plan"`.

### Task 4: Demo data, screenshots

**Files:**
- Modify: `src/server/demo/seed.ts` (+ `seed.test.ts`): through the real actions, at `now` minus a few hours, Starší completes and Táta approves tasks worth 112, Mladší 47 ("Vyndat myčku", "Uklidit koupelnu", …), and one completion of each boy stays pending ("Zalít kytky" 2, "Vynést tříděný" 3). The roller then starts the week at boot; the meeting shows step 1 with 2 items, then step 2 as in M2Settle.
- Screenshots (Playwright, dev server with `TASKMASTER_ENV=preview` on a fresh `DATA_DIR`, logged in as `tata`): `schuzka-giver-pending`, `schuzka-giver-settle`, `schuzka-giver-confirm`, `schuzka-giver-plan`, each at 360 and 390 px, light; one dark of step 2. Folder outside the repo.

- [ ] Seed test: `demo seed has 112 / 47 confirmed and 2 pending completions`. Run → FAIL; implement; PASS; commit `"Demo: a week ready for the meeting"`.
- [ ] Take and look at every screenshot.

### Task 5: Verify

- [ ] `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm db:check` → green.
- [ ] `pnpm mutation --mutate src/components/meeting/meetingView.ts,src/server/tasks/tasks.ts` → tests for real gaps.
- [ ] Label `preview` on the PR.
