# Weekly meeting screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The giver runs the weekly meeting on `/schuzka` in three steps (Schválit, Vyúčtovat, Plánovat) on top of the server part (PR #168).

**Architecture:** One route, `src/routes/_app/schuzka.tsx`, loads `getMeetingFn()` and the giver's task list, and renders a `MeetingScreen` component in `src/components/meeting/`. The step is client state derived from the loader data: step 1 while pending items exist, step 2 once empty, step 3 after a confirm (from the confirm's response, kept in state) or when there is nothing to settle. No new server rule; one new read (`listPlanTasks`) for step 3.

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
4. **Refusals** map to Czech toasts and reload: `totals_changed` "Mezitím se změnily body. Zkontroluj je a potvrď znovu." (stays on step 2, which always renders from the latest props, never from a copy in state), `pending_items` "Přibylo něco ke schválení." and back to step 1, `already_settled`/`wrong_period`/`nothing_to_settle` "Týden už je vyúčtovaný.", `no_takers` "Zatím tu nejsou žádné děti." (unreachable from the screen: `getMeeting` returns nothing to settle then), the rest a generic error.
5. **Step 3 lists** the coming week's tasks that still need something: proposed, open and reserved one-time tasks, newest first, as M3Plan: each row links to its task page (`/ukol/$taskId`), shows its state chip and score; a proposed task with bids shows "Odpovědět" (to the task page) and its lowest bid in the chip ("Mladší chce 20 b · ty 18 b", the existing bid chip text); a reserved one says who ("Rezervoval Starší", existing `cs` text). Empty list: `EmptyState` "Na tento týden zatím nic. Přidej úkol." Plus "+ Nový úkol" (to `/ukoly/novy`) and "Ukončit schůzku" (to Domů). No "Jiné hranice" button: per-period proposals are #43.
6. **Times shown come from the server:** "Vyúčtováno · ne 29. 11. 20:00" uses the confirm response's `settledAt`; the new week card uses the response's `next` (`startsAt`, `cutoffAt`, `levels`), never the browser clock or the reloaded meeting (whose `endsAt` is now for a running week).
7. **Colours** (existing theme tokens, `src/styles/theme.css`, no new ones): level badge upper = `state-confirmed` with `state-confirmed-text`, lower = `state-open` with `state-open-text`, none = `state-cancelled` with `state-cancelled-text` (as chips tint them, `color-mix` 15 %). Steps bar: done = `ok`, current = `primary`, not yet = `border`. Deducted number `destructive`, carry-over `ok`.

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

- Modify: `src/server/settlement/functions.ts` (+ test): `SettleResult` success gains `settledAt: string` (ISO, the records' `settledAt`) and `next: { id: number; startsAt: string; cutoffAt: string; levels: Levels } | null` in place of `nextPeriodId`.

**Interfaces:**
- Produces: `listPlanTasks(db: Db | Tx): TaskView[]` — status in `proposed | open | reserved`, newest first. `listPlanTasksFn(): Promise<TaskView[]>`. The new `SettleResult` above.

- [ ] Tests: `listPlanTasks lists proposed, open and reserved tasks, newest first` (a done, confirmed and cancelled task left out); `settled` returns `settledAt` and `next` with ISO times and levels (pinned with `toEqual`); meeting test `settling ends the week with the defaults passed in` (defaults `{ lengthDays: 14, … }` → `result.next.cutoffAt` = the Sunday 23:59 nearest start + 14 days).
- [ ] Run → FAIL; implement; run → PASS; commit `"Tasks for the meeting's plan step"`.

### Task 2: Meeting view helpers and strings

**Files:**
- Create: `src/components/meeting/meetingView.ts`, test `src/components/meeting/meetingView.test.ts`; `src/lib/settleErrors.ts` + test (next to `taskErrors.ts`)
- Modify: `src/lib/strings.ts` (`cs.meeting`)

**Interfaces:**
- Produces:
  - `weekLabel(startsAt: string, endsAt: string): string` → `"22. 11. – 29. 11."` (Prague days, no year).
  - `levelLabel(level: Level): string` → `Horní hranice` / `Spodní hranice` / `Bez kapesného`.
  - `shortfall(total: number, lower: number): string | null` → only for 0 < total < lower: the missing points with verb agreement, then the carry with `formatPoints`: 1 → `"Chyběl 1 bod. Nic nepropadá, 49 bodů jde do dalšího týdne."`, 2–4 → `"Chyběly 3 body. Nic nepropadá, 47 bodů jde do dalšího týdne."`, 5+ → `"Chybělo 47 bodů. Nic nepropadá, 3 body jdou do dalšího týdne."` (verb `jde` for 1 and 5+, `jdou` for 2–4); else null.
  - `settleErrorMessage(error: SettleError): string` in `src/lib/settleErrors.ts` (Ruling 4).
  - `dayTime(iso: string): string` → `"ne 29. 11. 20:00"` (Prague; for "Vyúčtováno" and the pending hint's week end).
- Strings `cs.meeting`: `title` (existing `cs.nav.meeting`), `steps: ['Schválit', 'Vyúčtovat', 'Plánovat']`, `pendingHint: (end) => 'Hotová práce do <end>. Dokud tu něco zbývá, nejde vyúčtovat.'` (end = `dayTime(endsAt)`), `levelsLabel: 'Hranice'`, `planEmpty: 'Na tento týden zatím nic. Přidej úkol.'`, `allClear: 'Vše vyřízeno'`, `allClearHint: 'Můžeš vyúčtovat týden.'`, `next: 'Dál: vyúčtovat'`, `left: (n) => 'Zbývá schválit: n'`, `levels: 'hranice'`, `total: 'Celkem'`, `deducted: 'Odečte se'`, `carry: 'Převádí se'`, `final: 'Vyúčtování je konečné. Opravit ho může jen správce.'`, `confirm: 'Potvrdit vyúčtování'`, dialog `confirmTitle: 'Vyúčtovat týden?'`, `confirmYes: 'Vyúčtovat'`, `settledAt: 'Vyúčtováno'`, `newWeek: 'Nový týden'`, `startWith: 'Začínají s'`, `planTasks: 'Úkoly na tento týden'`, `newTask: '+ Nový úkol'`, `end: 'Ukončit schůzku'`, `nothing: 'Teď není co vyúčtovat'`, `toast.settled: 'Týden je vyúčtovaný'`, the error texts.

- [ ] Tests: `weekLabel` for P1 (22. 11. – 29. 11.), `week label for an ended week uses its end` (ended early at Sun 20:00 → same day), across a month end (29. 11. – 6. 12.), an end at Sun 23:59 Prague = Sun 22:59 UTC but a start at Mon 00:30 Prague = Sun 23:30 UTC (Prague day wins), the October DST week (18. 10. – 25. 10.); `levelLabel` all three; `shortfall` 49 → 1 bod / 47 → 3 body / 3 → 47 bodů / 0 → null / 50 (= lower) → null / 130 → null; `dayTime` in winter and summer time; every `SettleError` maps to a distinct non-empty string.
- [ ] Run → FAIL; implement; run → PASS; commit `"Meeting labels and helpers"`.

### Task 3: Meeting screen

**Files:**
- Create: `src/components/meeting/MeetingScreen.tsx` (steps bar, step 1 = existing `ToApprove` with the hint, step 2 = a card per taker with `PointsBar` (confirmed = total, pending 0), level badge, three numbers, shortfall line; final note; confirm button + dialog; step 3 = new week card, plan tasks with `TaskRow`, buttons), `src/components/meeting/meeting.test.tsx`
- Modify: `src/routes/_app/schuzka.tsx` (loader: `getMeetingFn()` and `listPlanTasksFn()`; render `Meeting`)
- Modify: `src/lib/features.ts` only if present (Global Constraints)

**Interfaces:**
- Consumes: `getMeetingFn`, `settlePeriodFn`, `SettleResult`, `Meeting` (#168), `listPlanTasksFn`, `ToApprove`, `TaskRow`, `PointsBar`, `Dialog`, `Button`.
- Produces: `MeetingScreen({ meeting, plan, me }: { meeting: Meeting; plan: TaskView[]; me: number })`.
- Also create: `src/components/meeting/schuzkaPage.test.tsx` (route test, style of `homePage.test.tsx`) and `e2e/meeting.spec.ts`.
- Confirm sends `{ periodId, shown: takers.map(t => ({ takerId: t.id, total: t.total })) }`; on success keeps the `SettleResult` in state and shows step 3 with "Vyúčtováno · <dayTime(settledAt)>", the new week card from `next` (week label from `startsAt`/`cutoffAt`, "Hranice 50 / 100"; none when the settled week had already ended: "Tento týden běží dál"), and "Začínají s" each taker's `carryOver`, matched to names by `takerId`.

- [ ] Tests (Testing Library, mocked server functions as in `homePage.test.tsx`):
  - `pending items show step 1 and lock step 2` (button "Zbývá schválit: 2" disabled)
  - `approving the last pending item unlocks step 2 with fresh totals` (rerender with new props → "Dál: vyúčtovat" → step 2 shows 130 / −100 / 30)
  - `step 2 shows each taker's total, level, deduction and carry-over` (Starší 130 Horní hranice −100 30; Mladší 47 Bez kapesného 0 47 + "Chyběly 3 body…")
  - `confirm asks first, then settles with the shown totals` (dialog; Zpět sends nothing; Vyúčtovat calls `settlePeriodFn` with exactly `{ data: { periodId, shown } }`)
  - `confirm runs once` (double click → one call; button disabled while busy)
  - `after a confirm the screen shows step 3 and never step 2` (even after rerender with a meeting for the new week)
  - `step 3 shows each taker's carry-over by takerId and the new week from the response` (records returned in the opposite order of the takers; carry-overs land on the right names; week 29. 11. – 6. 12., Hranice 50 / 100, Vyúčtováno ne 29. 11. 20:00 from `settledAt`)
  - `totals_changed reloads and stays on step 2` (toast text, `router.invalidate` called; rerender with new totals → the screen shows them and the next confirm sends them)
  - `pending_items goes back to step 1`; `already_settled shows its toast`
  - `nothing to settle shows step 3 only`
  - `step 3 lists the plan tasks and links to new task and home` (row links to `/ukol/<id>`, Odpovědět on a task with bids, "Rezervoval Starší" on a reserved one)
  - `step 3 with no tasks shows the empty state`
  - route test: the loader calls `getMeetingFn` and `listPlanTasksFn` and the page renders the meeting, not the placeholder
  - e2e `meeting.spec.ts` (demo data, as `tata`): approve both pending items, Dál: vyúčtovat, Potvrdit vyúčtování, Vyúčtovat → step 3 shows "Začínají s"
- [ ] Run → FAIL; implement; run → PASS; commit `"Meeting screen: approve, settle, plan"`.

### Task 4: Demo data, screenshots

**Files:**
- Modify: `src/server/demo/seed.ts` (+ `seed.test.ts`): through the real actions, at `now` minus a few hours, Starší completes and Táta approves tasks worth 112, Mladší 47 ("Vyndat myčku", "Uklidit koupelnu", …), and one completion of each boy stays pending ("Zalít kytky" 2, "Vynést tříděný" 3). The roller then starts the week at boot; the meeting shows step 1 with 2 items, then step 2 as in M2Settle.
- Screenshots (Playwright, dev server with `TASKMASTER_ENV=preview` on a fresh `DATA_DIR`, logged in as `tata`): `schuzka-giver-pending` (with a long task name), `schuzka-giver-allclear`, `schuzka-giver-settle`, `schuzka-giver-confirm`, `schuzka-giver-totalschanged` (toast), `schuzka-giver-plan`, `schuzka-giver-plan-empty`, `schuzka-giver-nothing`, each at 360 and 390 px, light; one dark of step 2. Folder outside the repo.

- [ ] Seed test: `demo seed gives a meeting with 2 pending items and totals 112 / 47` (roll a period on the seeded DB, then `getMeeting`). Run → FAIL; implement; PASS; commit `"Demo: a week ready for the meeting"`.
- [ ] Take and look at every screenshot.

### Task 5: Verify

- [ ] `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm db:check` → green.
- [ ] `pnpm mutation --mutate src/components/meeting/meetingView.ts,src/server/tasks/tasks.ts` → tests for real gaps.
- [ ] Label `preview` on the PR.
