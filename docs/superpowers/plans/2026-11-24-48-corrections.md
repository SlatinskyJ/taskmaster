# Settlement correction and manual point adjustment: server (PR A of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#48 Settlement correction and manual point adjustment](https://github.com/SlatinskyJ/taskmaster/issues/48). This PR: the server half (store, ledger, server functions). PR B on top: the AFix screens on Správa ("Opravit" beside "Ponechat", "Upravit body"), the family's view of corrections and adjustments, the demo piece and e2e. PR B closes #48.

**Goal:** the admin can correct a final settlement and add or remove points by hand, directly or to resolve a dispute; the running total includes both everywhere it is read.

**Architecture:** the rules already exist in the domain (`src/domain/settlement.ts` `adjustPoints`, `correctSettlement`, `effectiveSettlement`; `src/domain/disputes.ts` `correctDispute`). This PR stores their results in two append-only tables, adds adjustments to the one points read (`ledgerEntries` / `takerPointsNow`), and exposes two admin server functions behind the `disputes` launch switch. Each write is one transaction with its audit entries.

**Tech stack:** TanStack Start server functions, Drizzle + SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.9 (corrections [call], manual adjustments), §5.10 (audit), §5.11 (correct a dispute); UI doc §7.5 AFix (PR B).

**Size:** about 380 changed lines outside tests and migrations (schema 60, store 160, functions 90, ledger/week/targets 60).

## Global constraints

- Admin only (`requireRole('admin')`, and the domain checks the admin again). Behind the launch switch `disputes` (one switch for #46–#48): off → `feature_off`, nothing written.
- Settlements stay final: the original row is never touched (triggers from 0015 stay). A correction is a new row linked to it.
- A correction never rewrites later settlements; the point difference is an adjustment to the **current** running total ([call] §5.9). Carry-over stays as stored.
- The running total never goes below zero (`would_go_negative`), and a removal is refused while an ended week waits for its meeting (ruling 8, `week_waiting`).
- A reason is required (trimmed, 1–1000 characters, the same limit as dispute text, Jakub 2026-11-24).
- Every state change writes its audit entry in the same transaction (`writeAudit`). Code, DB and logs in English.
- Never edit a committed migration; new migration via `pnpm db:generate --name corrections`.

## Rulings in this plan (go into the brief)

1. **A correction names a level, not points.** The admin picks the level the settlement should have had; the deduction is that settled period's level points (`none` → 0, `lower` → `period.levels.lower`, `upper` → `period.levels.upper`), the same rule the meeting used. A wrong total (a missed chore) is fixed by an adjustment instead. Cost if wrong: an odd deduction needs a level plus an adjustment.
2. **An adjustment counts in the week it was made**, like a completion counts in the week it was done: the meeting's total for a week includes adjustments made before that week's end (`made_at < end`), and Týden's "this week" includes those made since the week started. Without this, a correction made on Monday would read as "waiting for the meeting".
3. **Correcting from a dispute uses the correction's reason as the dispute's note** (one text field for the admin). The dispute closes as `corrected` in the same transaction.
4. **Seen value.** Like Ponechat, correcting from a dispute sends the value the admin saw; a moved value is refused with `value_changed`. A settlement's value is now its *effective* value (latest correction, else the original), so a second correction or a dismissal after a correction compares against what the family sees.
5. **Adjustment size:** a whole number, not 0, at most 9999 either way (a parser guard against typos; the spec sets no limit).
6. **Disputing an adjustment** becomes possible on the server (`loadTarget` reads the new table, value `{ points }`); the button to open one comes with PR B's family view.
7. **No demo piece in this PR:** nothing on screen uses it yet; PR B adds it with the screens.
8. **No removal while a week waits for its meeting** (Rules judge, rounds 1–2): a negative adjustment, or a correction whose difference is negative, is refused with `week_waiting` while any ended week is unsettled. Why: a removal after a cutoff is not in that week's total (ruling 2), and the meeting may still approve that week's pending items, so the meeting could deduct points that are already gone; the total would go negative and no later meeting could run. With no week waiting, a removal counts in the running week, the week's end total includes it, and today's total check is enough (later points only add). Additions and corrections that add points are never blocked. Cost: the admin removes points after Sunday's meeting instead of before it.
9. **Both new tables keep a nullable `dispute_id`** (which dispute the row resolved), so PR B's family view links a corrected dispute to its fix without reading the audit log.
10. **A disputed adjustment's title is its reason** (UX judge): rows on Sporné and Rozporováno tell adjustments apart; its value reads `+5 bodů` / `−3 body`.
11. **PR B note:** the correction reason is also the dispute note the family reads; the AFix form says so in a hint.

## Review focus

1. A correction measured against the latest correction, not the original (correcting twice never double-counts): domain already does it; the store must pass the latest correction row.
2. Two admins (or two taps) correcting the same dispute: the second gets `not_open`, and its correction and adjustment are rolled back.
3. A correction whose difference would take today's total below zero (a boy already spent the points): refused, nothing written.
4. The meeting after an adjustment: the week's settlement total includes it exactly once.
5. A period whose lower and upper levels are equal: `lower` → `upper` changes the level for the money but not the points, so a correction row is written and no adjustment row (the domain returns `adjustment: null`). Test it in Task 3.

---

### Task 1: Tables and migration

**Files:**
- Create: `src/server/db/schema/corrections.ts`; Modify: `src/server/db/schema/index.ts`
- Create: `drizzle/0026_corrections.sql` (generated) + append triggers by hand in the same new file before commit
- Test: `src/server/db/corrections-schema.test.ts`

**Interfaces — Produces:**
- `settlementCorrections`: `id`, `settlementId` → settlements.id, `level` (SETTLEMENT_LEVELS), `deducted` int, `reason` text, `madeBy` → users.id, `madeAt` text (UTC ISO). Checks: `deducted >= 0`, `(level = 'none') = (deducted = 0)`, `length(trim(reason)) BETWEEN 1 AND 1000`. Index on `settlement_id`.
- Both tables also have `disputeId` → disputes.id, nullable (ruling 9).
- `pointAdjustments`: `id`, `takerId` → users.id, `points` int, `reason` text, `correctionId` → settlement_corrections.id nullable, unique, `madeBy`, `madeAt`. Checks: `points <> 0`, reason 1–1000. Index on `taker_id`.
- Types `SettlementCorrectionRow`, `PointAdjustmentRow`.
- Triggers: `settlement_corrections_final`, `point_adjustments_final` (BEFORE UPDATE and BEFORE DELETE → RAISE(ABORT)).

- [ ] Step 1: tests (on `createTestDb()`): insert valid rows; refused: update, delete, `points = 0`, reason `''`/`'   '`, reason 1001 chars (1000 passes), `level 'none'` with `deducted 5`, `level 'lower'` with `deducted 0`, a second adjustment with the same `correctionId`, unknown settlement id (FK).
- [ ] Step 2: run, expect FAIL (no tables).
- [ ] Step 3: schema + `pnpm db:generate --name corrections`, append the four triggers to the new SQL file.
- [ ] Step 4: `pnpm vitest run src/server/db/corrections-schema.test.ts` and `pnpm db:check` pass.
- [ ] Step 5: commit "Add settlement correction and point adjustment tables".

### Task 2: Adjustments in the points read

**Files:** Modify `src/server/settlement/ledger.ts`, `src/server/settlement/week.ts` (`pointsSince`), test `src/server/settlement/ledger.test.ts`, `week.test.ts`, `meeting.test.ts`.

**Interfaces — Produces:** `ledgerEntries(db, until?)` also returns `{ kind: 'adjustment', takerId, points }` for every `point_adjustments` row (with `until`: `made_at < until`). `pointsSince` adds adjustments with `made_at >= start` to `confirmed`. Update the comments in ledger.ts, week.ts, points.ts that say "#48 adds…".

- [ ] Step 1: tests: `takerPointsNow` with a +7 and a −3 adjustment → confirmed +4; `ledgerEntries(db, until)` excludes one made exactly at `until` and includes one 1 ms before; Týden: an adjustment made this week shows in `confirmed`, `unsettled` stays 0; an adjustment made in an already settled week is **not** counted again in this week's `confirmed` (it is inside the carry-over); `pointsSince` boundary: one made exactly at the week's start counts, one 1 ms before does not; meeting preview of an ended week includes an adjustment made inside it once.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: commit "Count point adjustments in the running total".

### Task 3: Store: adjust and correct

**Files:** Create `src/server/corrections/read.ts` (`latestCorrection`, imports only the schema and the domain), `src/server/corrections/corrections.ts`, `src/server/corrections/README.md` (imports go corrections → disputes, settlement; never back; `targets.ts` imports only `corrections/read.ts`); Modify `src/server/disputes/targets.ts` (settlement value = effective, `adjustment` kind), `src/server/disputes/disputes.ts` (export a `closeAsCorrected(tx, …)` helper or the row→`Dispute` mapping it needs), `src/server/disputes/README.md`; test `src/server/corrections/corrections.test.ts`, `src/server/disputes/disputes.test.ts`.

**Interfaces — Produces:**
```ts
export type FixError = SettlementError | DisputeError | 'not_found' | 'value_changed' | 'not_open'
export interface FromDispute { disputeId: number; seen: DisputeValue | null }
export function adjustPointsIn(db, adminId, input: { takerId: number; points: number; reason: string }, from: FromDispute | null, now): Result<{ adjustmentId: number }, FixError>
export function correctSettlementIn(db, adminId, input: { settlementId: number; level: Level; reason: string }, from: FromDispute | null, now): Result<{ correctionId: number; adjustmentId: number | null }, FixError>
export function latestCorrection(db, settlementId): SettlementCorrectionRow | null   // corrections/read.ts, newest by made_at then id
```
`FixError` also has `week_waiting` (ruling 8): checked before the domain rule, for `points < 0` or a correction difference `< 0`, with "a week waits" = the meeting's own `periodToSettle(listPeriods, settledIds, now)` returns a period that has **ended** (`target && !isRunning(target, now)`; `periodToSettle` also returns the running week when it may be settled early, which does not count), read inside the same transaction as the insert. The domain's `currentTotal` is today's `takerPointsNow(tx)` confirmed.
A correction's deduction for the chosen level comes from **the settled period's** levels (ruling 1), never the running one.
The adjustment `about.title` is its reason (ruling 10).
`DisputeValue` gains `{ points: number }`; `loadTarget('adjustment')` returns `{ target: { kind: 'adjustment', id }, value: { points }, about: { title: <its reason>, takerId, week: null } }`; settlement `value` = `effectiveSettlement(original, latest)`.

One transaction each: read people + current total (`takerPointsNow(tx)`), run the domain rule, then if `from`: load the dispute + its target (`not_found`), `correctDispute` (a settlement correction must match the disputed settlement: `wrong_correction`), `valueMoved(seen, now)` → `value_changed`; insert rows; if `from`, `update disputes … where id and status='open'` (0 rows → `not_open`, the transaction is rolled back by throwing a private error and mapping it, or by checking before inserting and relying on the update count — pick the one that leaves no rows, test proves it). Audit, in order: `settlement.corrected` (entity settlement, after `{ correctionId, level, deducted, reason }`, before `{ level, deducted }` effective), `points.adjusted` (entity adjustment, after `{ takerId, points, reason, correctionId }`), `dispute.corrected` (entity dispute, before `{ status: 'open' }`, after `{ status: 'corrected', note, value, correction: { kind, id } }`).

- [ ] Step 1: tests:
  - adjust: +5 writes a row and `points.adjusted`; `points` exactly −total passes (total 0), −total−1 → `would_go_negative`; a giver or taker as actor → `not_admin`; a giver as `takerId` → `not_a_taker`; blank reason → `reason_required`.
  - correct: lower→upper writes a correction and an adjustment of `lower − upper`; upper→none returns the deduction; same level → `no_change`; corrected **three times** (none→lower→upper→lower): each adjustment is measured from the one before (`latestCorrection` returns the newest, not the oldest), the total equals the last level's effect; the settled period's levels differ from the running period's (30/60 vs 50/100): the deduction uses 30/60; a period with equal levels (50/50): lower→upper writes a correction and no adjustment row; a difference that would go below zero → `would_go_negative`; the settlement row is unchanged.
  - week waiting: week ended, meeting not held: −5 adjustment → `week_waiting`, +5 passes, a correction that removes points → `week_waiting`, one that adds passes; after the meeting a −5 passes; with no ended week (the running week could be settled early), a removal down to exactly 0 passes and 1 more is `would_go_negative`; then the meeting of that week settles with total ≥ 0 and the next meeting still opens.
  - audit and links: `points.adjusted`, `settlement.corrected`, `dispute.corrected` each written once with the before/after above; the correction's adjustment row has `correctionId` = the correction's id; both rows carry `disputeId` when made from a dispute, null otherwise.
  - from a dispute: closes it `corrected` with the reason as note; a settlement correction on a dispute about another settlement → `wrong_correction`; seen value stale → `value_changed`, both for a correction and for an adjustment from a dispute; dispute already closed → `not_open` and **no** correction/adjustment rows; an adjustment from a `completion` dispute works.
  - rollback: `writeAudit` throws on `points.adjusted` / `dispute.corrected` → no rows in any of the three tables changed.
  - targets: an `adjustment` dispute opens (locked) with value `{ points }` and title = its reason; a settlement's value after a correction is the corrected one (dismiss with the original value → `value_changed`).
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: commit "Store settlement corrections and point adjustments".

### Task 4: Server functions

**Files:** Create `src/server/corrections/functions.ts`; Modify `src/lib/disputeLimits.ts` (add `FIX_REASON_MAX = 1000`, `ADJUST_POINTS_MAX = 9999`), `src/server/disputes/functions.ts` (`parseDismissDispute` accepts `{ points }` values; `OPENABLE_KINDS` gains `adjustment`), `src/components/disputes/disputeProps.ts` (`adminDisputeLines` shows a `{ points }` value), `src/lib/strings.ts` (`cs.disputes.adjustmentValue(points)`: `+5 bodů`, `−3 body` (both cases tested), built on `formatPoints` with a sign), `tests/server-fn-guards.test.ts`; test `src/server/corrections/functions.test.ts`.

**Interfaces — Produces:** `adjustPointsFn` (POST, admin) input exactly `{ takerId, points, reason, from }`; `correctSettlementFn` (POST, admin) input exactly `{ settlementId, level, reason, from }`; `from` is `null` or exactly `{ disputeId, seen }`. Both answer `{ ok: true } | { ok: false; error: FixError | 'feature_off' }` (no ids, no rows). Handlers `adjustPointsHandler(db, adminId, input, now)`, `correctSettlementHandler(...)` exported for tests. `EXPECTED_ROLES`: both `'admin'`.

Ids (`takerId`, `settlementId`, `from.disputeId`) go through the existing `positiveId`.

- [ ] Step 1: tests: `adminDisputeLines` for an adjustment pins `value` (`+5 bodů`) and `name`; `openDisputeHandler` opens an `adjustment` dispute through the real parser; `dismissDisputeHandler` keeps an adjustment dispute with a `{ points }` seen value and refuses a stale one; parser refuses extra keys, `points` 0 / 1.5 / 10000 / −10000 (9999 and −9999 pass), reason 1001 after trim (1000 passes), level outside SETTLEMENT_LEVELS, `from` with extra keys; switch off → `feature_off` and nothing written; the handler result is exactly `{ ok: true }` (shape pinned); guard test lists both.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: `pnpm test`, `pnpm typecheck`, `pnpm lint` pass. Step 5: commit "Add admin server functions to correct and adjust points".

### Task 5: Clean up

- [ ] `git rm` this plan in its own commit, brief, PR ready (no `preview` label: no screen changes beyond one admin label), code review rounds.
