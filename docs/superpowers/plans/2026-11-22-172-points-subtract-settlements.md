# Points subtract settlements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#172 Points subtract settlements](https://github.com/SlatinskyJ/taskmaster/issues/172)

**Goal:** The points shown on Domů (taker and giver home) are the running total after settlements: 130 confirmed → settle at upper 100 → 30.

**Architecture:** `takerPoints` (`src/server/points/points.ts`) builds its own completion-only ledger from `tasks`. The settlement module already has the one points read, `takerPointsNow(db)` in `src/server/settlement/ledger.ts` (completions + settlement deductions, plus pending), used by Týden. `takerPoints` switches to it and keeps only what it adds: the list of active takers (with names, zero rows for takers with nothing) and the levels. No new query, no schema change, no screen change.

**Tech Stack:** TypeScript, Drizzle/SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.7 (confirmed = running total: carry-over + confirmed this period), §5.9 (settlement deducts the level's points; example lower 50, upper 100, total 130 → 100 deducted, 30 carries; total 30 → none, 30 carries).

**Size:** about 30 changed lines in `points.ts` and comments in `ledger.ts`; tests about 50 lines.

## Global Constraints

- §5 rules stay in `src/domain/` (`runningTotal`); this change only wires the server read.
- Read-only: no state change, so no audit entry.
- No feature flag: this fixes the existing points read; the meeting flag (`meeting`) only gates the screen that writes settlements.
- Pending points are unchanged: done, unconfirmed tasks with an earner, summed per earner.

## Review Focus

1. A taker who reached no level (total < lower) keeps everything: 30 → settle → still 30 (Task 1 test).
2. A second week: carry-over plus new confirmed points (30 carry + 20 new = 50) (Task 1 test).
3. Pending points of the new week are not touched by the old settlement and stay apart from confirmed (Task 1 test 2; the meeting refuses to settle while older pending items exist, so none straddle it).
4. An active taker with no tasks and no settlement still gets a zero row (existing test `is zero for every taker with no tasks` stays green).
5. Giver view and taker view both read the settled total (`pointsView` filters `takerPoints`, so covered by Task 1 through `takerPoints`; existing `pointsView.test.ts` stays green).

---

### Task 1: `takerPoints` reads the settled running total

**Files:**
- Modify: `src/server/points/points.ts` (`takerPoints`, header comment)
- Modify: `src/server/settlement/ledger.ts` (doc comment of `takerPointsNow`: drop "should too (#172)", name Domů as a user)
- Test: `src/server/points/points.test.ts` (new `describe('takerPoints after a settlement')`)

**Interfaces:**
- Consumes: `takerPointsNow(db: Db | Tx): Map<number, { confirmed: number; pending: number }>` from `~/server/settlement/ledger`; test helpers `week`, `doneTask`, `plus`, `SAT`, `MEETING`, `prague` from `~/server/settlement/testing`; `settlePeriod`, `getMeeting` from `~/server/settlement/meeting`.
- Produces: `takerPoints(db, now): PointsOverview` unchanged in shape.

- [ ] **Step 1: Write the failing tests** in `points.test.ts`. A local helper `settle(f, now)` calls `must(settlePeriod(f.db, f.tata, f.p1.id, shown, now))` with `shown` = `getMeeting(f.db, now).takers.map(t => ({ takerId: t.id, total: t.total }))`.

```ts
describe('takerPoints after a settlement', () => {
  it('confirmed drops by the deduction: 130 → settle at upper → 30; below lower keeps all', () => {
    const f = week()
    doneTask(f, { score: 100, completedAt: plus(SAT, 3_600_000), earner: f.starsi })
    doneTask(f, { score: 30, completedAt: plus(SAT, 7_200_000), earner: f.starsi })
    doneTask(f, { score: 30, completedAt: plus(SAT, 7_200_000), earner: f.mladsi })
    expect(takerPoints(f.db, MEETING).takers.map((t) => t.confirmed)).toEqual([130, 30])
    settle(f, MEETING)
    const after = plus(MEETING, 1000)
    expect(takerPoints(f.db, after).takers.map((t) => [t.confirmed, t.pending])).toEqual([[30, 0], [30, 0]])
  })

  it('next week: carry-over plus new confirmed, pending apart', () => {
    // as above, settle at MEETING, then in P2:
    // starsi confirmed 20 (completedAt plus(MEETING, 60_000)), mladsi done_unconfirmed 9
    // expect [[50, 0], [30, 9]]
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm test src/server/points/points.test.ts`
Expected: FAIL, first test gets `[[130, 0], [30, 0]]` after the settlement.

- [ ] **Step 3: Implement.** In `takerPoints`, drop the `tasks` query and the local ledger; call `const now_ = takerPointsNow(db)` and map each active taker to `confirmed: p?.confirmed ?? 0, pending: p?.pending ?? 0`. Remove the now-unused imports (`tasks`, `inArray`, `isNotNull`, `runningTotal`, `LedgerEntry`). Rewrite the header comment: confirmed comes from `takerPointsNow` (completions − settlement deductions); #48 adds adjustments there. Check `~/server/settlement/ledger` does not import from `~/server/points` (no cycle).

- [ ] **Step 4: Run the points and settlement tests**

Run: `pnpm test src/server/points src/server/settlement`
Expected: PASS, including every existing `takerPoints` and `pointsView` test unchanged.

- [ ] **Step 5: Full checks and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green.

```bash
git add src/server/points src/server/settlement/ledger.ts
git commit -m "Points on Domů subtract settlements"
```
