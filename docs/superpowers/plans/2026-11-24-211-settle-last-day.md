# Settle the running week only on its last day — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#211 Settle the running week only on its last day](https://github.com/SlatinskyJ/taskmaster/issues/211) (epic #204).

**Goal:** Schůzka can settle the running week only on its last day (Prague); before that it shows when the week ends. An ended week stays settleable any time.

**Architecture:** The domain's `canSettle` / `periodToSettle` get a `lastDayOnly` flag. The server functions read a new launch switch `settleLastDay` and pass it down; `getMeeting` returns the running week's end when that rule is the only thing stopping the meeting. Schůzka step 3 shows the end instead (component test only: the server has no injectable clock, so no e2e; the brief says so) of "Teď není co vyúčtovat".

**Tech Stack:** TS domain (`src/domain/`), Drizzle/SQLite, TanStack Start server fns, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.8 (periods), §5.9 (meeting).

**Size:** about 120 changed lines outside tests and the migration (spec 2 lines, domain ~25, server ~30, screen + strings ~35, switch plumbing ~10). One PR.

## Decided (Jakub, 2026-11-24, on the issue and in the project thread)

- The running week can be settled only on its last day: the Prague calendar day of its cutoff (normally Sunday). Before that Schůzka shows when the week ends instead of the Vyúčtovat step.
- A week that already ended at its cutoff can still be settled any time after (unchanged).
- Cutoff at 00:00 (Jakub, 2026-11-24 15:20 Prague, decision card): the last day is the day the week's last minute falls on, so Monday 00:00 → Sunday.
- Jakub: "flip its prod switch once merged (before Sun 29 Nov)". The new migration therefore writes the switch **on**: merging is the flip. Prod auto-deploys on green `main`, so it is live before Sunday. The switch stays as a lever to turn the rule off by hand (README command) without a deploy.

## Global Constraints

- Czech UI text only in `src/lib/strings.ts`; code in English.
- All Prague wall-clock maths through `src/domain/dates.ts`.
- `src/domain/` stays framework-free.
- Never edit a committed migration; new migration via `pnpm db:generate --name settle_last_day_switch` (custom SQL, like 0024).
- No new state change, so no new audit entry (settling already audits; the switch row is written by a migration, like 0022/0024: no audit row).

## Review Focus

1. **Last day = the day of the last instant inside the week**, `cutoffAt − 1 ms`, not the day of `cutoffAt`. A cutoff at Monday 00:00 makes Sunday the last day. Test it.
2. **DST**: a week ending Sunday 25 Oct 2026 23:59 (fall back) — Sunday 00:00–23:59 Prague all settleable; Saturday 23:59 not. Test the Saturday/Sunday midnight boundary in Prague time, not UTC (Prague 00:00 = 23:00 UTC in winter).
3. **A late meeting** (ended week unsettled) on a Wednesday still settles that ended week with the switch on.
4. **Seed and e2e stay deterministic**: the demo seed settles its past week mid-week; it must keep doing so with the switch row on (it passes `lastDayOnly: false` explicitly), on every weekday (`demo.test.ts` NOWS).
5. **Server refuses**, not just the screen: `settlePeriodFn` with the switch on, mid-week → `nothing_to_settle`, nothing written.

---

### Task 1: Spec §5.8

**Files:** Modify `docs/superpowers/specs/2026-11-16-taskmaster-design.md` (§5.8 lines "Settling ends the period" and "Settlement of the running period is allowed…").

- [ ] **Step 1:** In the "Settling ends the period" bullet, replace "the meeting normally runs before the cutoff" with "the meeting normally runs on the period's last day, before the cutoff".
- [ ] **Step 2:** Replace the last §5.8 bullet with: "Settlement of the running period is allowed only on its **last day** (Jakub, 2026-11-24): the Prague calendar day its last minute falls on (normally Sunday; a cutoff at 00:00 makes it the day before). It ends the period, see above. Before that day the meeting screen shows when the period ends. Settlement of a period that ended at its cutoff is allowed any time after."
- [ ] **Step 3:** Commit `Spec: settle the running week only on its last day (#211)`.

### Task 2: Domain rule

**Files:** Modify `src/domain/periods.ts` (`canSettle`, `periodToSettle`), test `src/domain/periods.test.ts`.

**Interfaces — Produces:**
- `isLastDay(period: PeriodSpan, now: Date): boolean` — `pragueDaysBetween(now, new Date(period.cutoffAt.getTime() - 1)) === 0`.
- `canSettle(period: PeriodSpan, now: Date, lastDayOnly: boolean): boolean` — today's rule, and when `lastDayOnly` and `now < cutoffAt`, also `isLastDay`. After the cutoff unchanged (true).
- `periodToSettle(periods, settled, now, lastDayOnly: boolean)` — passes it to `canSettle` for the running period; the ended-week branch is untouched.

- [ ] **Step 1: Failing tests** in `periods.test.ts`, new `describe('settle only on the last day (#211)')` with `WEEK` (cutoff Sun 22 Nov 2026 23:59):
  - `canSettle(WEEK, prague(2026,11,21,23,59), true)` → false; `prague(2026,11,22,0,0)` → true; `plus(WEEK.cutoffAt,-1)` → true; `plus(WEEK.cutoffAt, 3 days)` → true (ended at cutoff); with `false` the Saturday case → true (old rule).
  - Cutoff Monday 00:00 (`{...WEEK, cutoffAt: prague(2026,11,23,0,0)}`): Sunday 22 Nov 10:00 → true, Saturday 21 Nov 23:59 → false.
  - DST: a week with cutoff `prague(2026,10,25,23,59)`: `prague(2026,10,24,23,59)` false, `prague(2026,10,25,0,0)` true.
  - A one-day period started on its cutoff day at 10:00: 10:00 exactly false (start rule), 10:01 true.
  - `periodToSettle([ended unsettled, running], ∅, Wednesday, true)` → the ended one; `periodToSettle([running], ∅, Wednesday, true)` → undefined; on Sunday → running.
  - Existing `canSettle` / `periodToSettle` calls get `false` (behaviour unchanged).
- [ ] **Step 2:** `pnpm vitest run src/domain/periods.test.ts` → new cases FAIL.
- [ ] **Step 3:** Implement; update the doc comments (spec §5.8, Jakub 2026-11-24). Export `isLastDay` from `~/domain`.
- [ ] **Step 4:** Tests PASS. `pnpm mutation --mutate src/domain/periods.ts` on the changed lines: no surviving mutant in `isLastDay`/`canSettle`.
- [ ] **Step 5:** Commit.

### Task 3: Launch switch `settleLastDay`

**Files:** `src/lib/features.ts` (key last in `FEATURE_KEYS`, `NO_FEATURES`, `ALL_FEATURES`, doc line "#211"; the file's top comment and the README's first line say a switch can also hold a rule, not only hide an unfinished feature), new migration `drizzle/0027_settle_last_day_switch.sql` + journal, `src/server/features/README.md` (one line), `src/server/features/flags.test.ts`.

- [ ] **Step 1: Failing test** in `flags.test.ts`: the migrated DB reads `settleLastDay: true` (update the "values the migrations leave" expectation and its title: "0027 settleLastDay on").
- [ ] **Step 2:** Migration SQL, with a comment citing Jakub 2026-11-24 "flip once merged":
  `INSERT INTO \`feature_flags\` (\`key\`, \`enabled\`) VALUES ('settleLastDay', 1);`
- [ ] **Step 3:** `pnpm db:check` passes; `pnpm vitest run src/server/features` passes. Fix any test that lists every key (search `NO_FEATURES`/`ALL_FEATURES` users; e.g. the `launch` seed test must still be all off).
- [ ] **Step 4:** Commit.

### Task 4: Server — meeting and settle use the rule

**Files:** `src/server/settlement/meeting.ts`, create `src/server/settlement/actions.ts` (+ `actions.test.ts`), `src/server/settlement/functions.ts`, `src/server/demo/pieces.ts`, `src/server/corrections/corrections.ts` (only if `weekWaiting` signature changes — it does not), tests `meeting.test.ts`, `functions.test.ts`.

**Interfaces — Consumes:** `periodToSettle(…, lastDayOnly)`, `getFlags(db).settleLastDay`.
**Produces:**
- `getMeeting(db, now, lastDayOnly: boolean): Meeting` where the no-week variant becomes `{ period: null; runningCutoffAt: string | null }`: `runningCutoffAt` = ISO UTC of the running week's `cutoffAt` when a running, unsettled, started week exists and only the last-day rule keeps it from the meeting; else `null`. (Name: the UI shows the cutoff; the day of it is when settling opens.) Rule: `runningCutoffAt` is set iff `lastDayOnly && periodToSettle(…, false)` returns the running week while `periodToSettle(…, true)` returns undefined.
- `settlePeriod(db, giverId, periodId, shown, now, lastDayOnly: boolean)` — passes it to `periodToSettle`; mid-week with `true` → `nothing_to_settle`.
- `weekWaiting` keeps `periodToSettle(…, false)` with a comment: the running week never counts, so the rule changes nothing there.
- New `src/server/settlement/actions.ts` (pattern of `src/server/users/actions.ts`), the whole handler bodies, each reading the switch itself:
  - `meetingNow(db: Db, now: Date): Meeting` = `getMeeting(db, now, getFlags(db).settleLastDay)`
  - `settleNow(db: Db, giverId: number, data: { periodId: number; shown: ShownTotal[] }, now: Date): SettleResult` = `settled(settlePeriod(db, giverId, data.periodId, data.shown, now, getFlags(db).settleLastDay))` (`settled` moves here from `functions.ts`).
  - `getMeetingFn` / `settlePeriodFn` become one-line calls with `getDb()`, `context.user.id`, `new Date()`.
- Demo `pastWeekWith`: passes `false` to both, with a comment (it builds history mid-week; the seed's switches are set after the pieces).

- [ ] **Step 1: Failing tests** in `meeting.test.ts` (`describe('last day only (#211)')`), on the existing `example()` week (cutoff Sun 22 Nov 23:59):
  - `getMeeting(db, SAT, true)` → `{ period: null, runningCutoffAt: toIsoUtc(CUTOFF) }`; `getMeeting(db, MEETING, true).period` not null (Sunday 20:00).
  - `settlePeriod(…, SAT, true)` → `nothing_to_settle`, no settlement rows, no audit rows, week not ended.
  - Late meeting: on `MONDAY` with week 1 ended unsettled, `getMeeting(…, true).period.id` is week 1.
  - No week at all / no takers → `runningCutoffAt: null`.
  - Existing tests: pass `false` (or `true` where they run on Sunday) — no behaviour change; `{ period: null }` expectations become `{ period: null, runningCutoffAt: null }`.
- [ ] **Step 2:** `actions.test.ts` (migrated test DB, `example()` week): switch on (migration default) → `meetingNow(db, SAT)` = `{ period: null, runningCutoffAt: <cutoff ISO> }` (shape pinned: exactly these two keys) and `settleNow(db, tata, …, SAT)` → `{ ok: false, error: 'nothing_to_settle' }`, no settlement rows, week not ended; switch set off (`UPDATE feature_flags`) → `settleNow` at SAT settles. On Sunday `MEETING` with the switch on both work. The `settled`/`parseSettle` tests stay where they test.
- [ ] **Step 3:** Run → FAIL. Implement. Run `pnpm vitest run src/server` → PASS, including `src/server/demo/demo.test.ts` (all weekdays).
- [ ] **Step 4:** Commit.

### Task 5: Schůzka shows when the week ends

**Files:** `src/components/meeting/MeetingScreen.tsx` (`StepPlan`), `src/lib/strings.ts` (`cs.meeting`), `src/components/meeting/meeting.test.tsx`, `meetingFlow.test.ts` / `fixtures.ts` (type update only).

Copy (new keys in `cs.meeting`):
- `notYet: 'Týden ještě běží'`
- `runsUntil: (end: string) => \`Týden běží do ${end}.\`` with `end = untilLabel(runningCutoffAt)` (genitive day name after "do": "neděle 29. 11. 23:59", "soboty 28. 11. 23:59"); no new date maths.
- `settleOnLastDay: 'Vyúčtovat půjde až v poslední den týdne.'`

- [ ] **Step 1: Failing test** in `meeting.test.tsx`: `render({ period: null, runningCutoffAt: <Sun 29 Nov 23:59 ISO> })` contains `Týden ještě běží`, `Týden běží do neděle 29. 11. 23:59.`; a Saturday cutoff (28 Nov 23:59) reads `Týden běží do soboty 28. 11. 23:59.`; both contain `poslední den týdne`, and not `Teď není co vyúčtovat` and not `Potvrdit vyúčtování`. `render({ period: null, runningCutoffAt: null })` keeps `Teď není co vyúčtovat`.
- [ ] **Step 2:** Implement in `StepPlan`: when `nothing && runningCutoffAt`, the same sticker card shows the three lines instead of `cs.meeting.nothing`. Static text, no tap targets, no animation, no request (UX pre-flight: nothing to add). Long text wraps (`break-words`), card at 360 px.
- [ ] **Step 3:** Tests PASS; `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 4:** Commit.

### Task 6: Verify, screenshots

- [ ] `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build && pnpm db:check`.
- [ ] `pnpm e2e` for the `meeting` suite: unchanged (seed `week` leaves `settleLastDay` off, so it still settles mid-week). No new e2e: the gate depends on the weekday of the CI run; unit + component tests pin it with fixed clocks.
- [ ] Screenshots (393×852, demo seed, Táta): Schůzka mid-week with the new card; (UX) 360×800 too. No form, so no keyboard shot.
- [ ] Delete this plan in its own commit, write the brief, mark ready, `preview` label.
