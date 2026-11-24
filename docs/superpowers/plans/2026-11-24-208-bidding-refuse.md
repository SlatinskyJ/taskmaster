# Bidding: same number and a way to refuse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (CLAUDE.md). Steps use checkbox (`- [ ]`) syntax.

**Issue:** [#208 Bidding: same number and a way to refuse](https://github.com/SlatinskyJ/taskmaster/issues/208)

**Goal:** A brother may repeat his previous bid only after a parent countered; a brother can withdraw his own bid ("Nechci"); a parent can turn the bidding down (all bids close, task stays Návrh).

**Architecture:** Two new domain functions in `src/domain/bidding.ts` and one changed rule; two new server actions in `src/server/tasks/bidding.ts` writing thread rows + audit in one transaction; two buttons on the task page behind a new launch switch `bidRefusals`. No schema change: both refusals close thread rows as `closed` (the existing value); the audit action tells them apart.

**Tech Stack:** TS strict, Drizzle/SQLite, TanStack Start server functions, React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.2 bullets "Same number", "A taker says no", "A giver turns the bidding down" (spec PR [#225](https://github.com/SlatinskyJ/taskmaster/pull/225); this PR is stacked on it).

## Global Constraints

- Czech UI text only in `src/lib/strings.ts`; code, audit actions, identifiers in English.
- Every state change writes its audit entry in the same transaction (`writeAudit`).
- `src/domain/` stays framework-free.
- New launch switch: added to `FEATURE_KEYS`, seeded **off** by a new migration, on in the `demo` seed and the `tasks` e2e seed. Server functions refuse with `feature_off` when it is off (pattern: `src/server/disputes/functions.ts` `isOn`).
- Phone keyboard rule: no new form field (buttons only), so no new `e2e/keyboard.spec.ts` case.
- Only one-time tasks. Template score changes (§5.1) are out of scope here; proposed-template bidding is [#209](https://github.com/SlatinskyJ/taskmaster/issues/209).

## Decisions (rulings for the judges)

1. **"Previous bid" = the taker's newest thread row since the newest giver row.** A giver row is written by a counter, by the release re-offer, and (new) by a turn-down. So a counter or turn-down resets the check; a withdrawn bid still counts ([call] in spec). Computed by the server from `task_thread` and passed to the domain; the domain stays free of rows.
2. **The turn-down re-issues the current offer**: the open giver row closes `replaced`, a new giver row at the same score by the turning-down giver, `offer_round + 1`, his approval row. This is what makes decision 1 reset after a turn-down, and it records who stands behind the offer now. No taker approval can be pending (a taker's yes would have agreed the task), so nothing a taker did is lost.
3. **The same-number rule is not behind the switch.** With refusals off it differs from today only in allowing a brother to repeat his bid after a counter (today refused); everything else is today's rule. The two new actions and their buttons are behind `bidRefusals`.
4. **Stale screens.** Withdraw needs no stale check (only his own bid). A turn-down sends the bids the giver saw (`{ takerId, score }[]`); if the open bids differ (any order), it is `offer_changed` and nothing closes.
5. **No dialog.** Both actions are undoable by bidding again; like the other bid buttons, each has its outcome hint under it.

**Size:** about 300 changed lines without tests and the migration (domain ~60, server ~120, screens ~90, strings ~15). One PR.

## Pre-flight

- Tests: each new action rolls back when its audit write fails (Task 2, pattern of the existing rollback tests in `bidding.test.ts`); each action tried by the wrong actor (Task 1, Task 2); both server functions run through their real entry with the switch on and off (Task 2); `TaskView.lastBids` shape pinned in an existing view test (Task 2).
- UX: both buttons use `Button` (full width, `min-h-tap`), busy state through `useTaskAction` like the other bid buttons, failure → `taskErrorMessage` toast (new `feature_off` → `cs.tasks.errors.notAllowed`); no new loader, no new row (task name not shown in the new controls); no dialog (decision 5).

## Review Focus

1. Brother bids 5, parent counters 4, brother sends 5 again → accepted (today refused). Test in Task 1 and Task 2.
2. Brother bids 5, Nechci, bids 5 → refused `same_score`; after a counter → accepted. Task 1 + Task 2.
3. Parent turns down while a new bid arrived after his screen loaded → `offer_changed`, no bid closed. Task 2.
4. After a turn-down, a brother's Souhlasím agrees the task at the offer (offer still valid, new round). Task 2.
5. Switch off → both server functions answer `feature_off` and no button shows. Task 3 + Task 4.

---

### Task 1: Domain rules

**Files:**
- Modify: `src/domain/bidding.ts`, `src/domain/agreement.ts` (proposed `OneTimeAgreement` gets `lastBids`), `src/domain/index.ts` (exports)
- Test: `src/domain/bidding.test.ts`

**Interfaces:**
- Produces:
  - `OneTimeAgreement` proposed variant: `{ status: 'proposed'; offer: ScoreProposal; book: BidBook; lastBids: readonly OpenBid[] }` — each taker's newest bid since the newest giver row (open or withdrawn). `createOneTimeTask` sets `lastBids: []`. Every place that builds a proposed agreement passes it.
  - `placeOneTimeBid(task, people, takerId, score)`: `same_score` when `score === offer.score` or `score === lastBids.find(by===takerId)?.score`. (Replaces the check against his open bid.)
  - `withdrawOneTimeBid(task, people, takerId): Result<OneTimeAgreement, AgreementError>` — `not_proposed`, `not_a_taker`, `no_bid` (no open bid); else the book without his bid, `lastBids` unchanged.
  - `turnDownOneTimeBids(task, people, giverId, seen: readonly OpenBid[]): Result<OneTimeAgreement, AgreementError>` — `not_proposed`, `not_a_giver`, `no_bids` (live book empty), `offer_changed` (live book ≠ `seen` as a set of `{by, score}`); else `{ ...task, book: EMPTY_BOOK, lastBids: [], offer: proposeScore(giverId, offer.score) }`.

- [ ] **Step 1: Failing tests** in `bidding.test.ts`, `describe('same number (Jakub 2026-11-24)')`, `describe('withdrawOneTimeBid')`, `describe('turnDownOneTimeBids')`:
  - `lastBids [{by: starsi, score: 5}]`, open bid 5 → `placeOneTimeBid(…, starsi, 5)` fails `same_score`.
  - `lastBids []` (a counter happened), open bid 5 → bid 5 ok, book `[{starsi,5}]`.
  - withdrawn: book empty, `lastBids [{starsi,5}]` → bid 5 `same_score`, bid 6 ok.
  - offer 10 → bid 10 `same_score` (unchanged).
  - withdraw: removes only his bid (`mladsi` 22 stays); no bid → `no_bid`; giver → `not_a_taker`; agreed task → `not_proposed`.
  - turn down: two bids, `seen` same in other order → book empty, `lastBids []`, `offer.score` unchanged, `offer.proposedBy` = giver, `approvedBy [giver]`; `seen` missing one bid → `offer_changed`; `seen` with a different score → `offer_changed`; no bids → `no_bids`; taker → `not_a_giver`.
- [ ] **Step 2:** `pnpm test src/domain/bidding.test.ts` → FAIL (functions not exported).
- [ ] **Step 3:** Implement as in Interfaces. Fix callers of the proposed variant (`createOneTimeTask`, `resolveOneTime`, test builders) to carry `lastBids`.
- [ ] **Step 4:** `pnpm test src/domain` → PASS; `pnpm typecheck` shows only server errors fixed in Task 2.
- [ ] **Step 5:** commit "Bidding domain: same number after a counter, withdraw, turn down".

### Task 2: Server actions, switch, migration

**Files:**
- Modify: `src/lib/features.ts` (key `bidRefusals`, off in `NO_FEATURES`, on in `ALL_FEATURES`), `src/server/features/README.md` (one line: migration 0027 adds `bidRefusals`, off)
- Create: `drizzle/0027_bid_refusals_switch.sql` via `pnpm db:generate --custom --name bid_refusals_switch` (same shape as `0024_disputes_switch.sql`)
- Modify: `src/server/tasks/thread.ts` (`lastBids`), `src/server/tasks/tasks.ts` (`agreementOf` fills `lastBids`; `TaskView.lastBids`), `src/server/tasks/bidding.ts` (`withdrawBid`, `turnDownBids`), `src/server/tasks/functions.ts` (two server functions), `src/server/audit/actions.ts` (`task.bid_withdrawn`, `task.bids_turned_down`)
- Test: `src/server/tasks/bidding.test.ts`, `src/server/tasks/thread.test.ts`, `src/server/tasks/functions.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `lastBids(db, taskId): ThreadRow[]` — per taker, his newest `side='taker'` row with `id >` the newest `side='giver'` row's id.
  - `TaskView.lastBids: { takerId: number; score: number }[]` (proposed only, else `[]`).
  - `withdrawBid(db, takerId, taskId, now?): Result<TaskRow, TaskError>` — closes his open bid `closed`; audit `task.bid_withdrawn`, `before { entryId, score }`.
  - `turnDownBids(db, giverId, taskId, seen: {takerId, score}[], now?): Result<TaskRow, TaskError>` — closes every open bid `closed`, `addEntry` a giver row at `task.score`, `offerRound + 1`, approval row for the giver; audit `task.bids_turned_down`, `before { entryIds, offerEntryId }`, `after { score, offerRound, entryId }`.
  - `withdrawBidFn` (role taker, `{ taskId }`), `turnDownBidsFn` (role giver, `{ taskId, bids: {takerId, score}[] }`, 0–50 items like `bidders`). Both return `TaskActionResult`; `{ ok: false, error: 'feature_off' }` when `getFlags(db).bidRefusals` is false. `TaskError` gains `'feature_off'`.

- [ ] **Step 1: Failing tests** (`createTestDb()` + `src/server/tasks/testing.ts` helpers):
  - Review Focus 1: bid 5, counter 4, bid 5 → ok, thread: first 5 `replaced`, new 5 open.
  - Review Focus 2: bid 5, withdraw → row `closed`, audit `task.bid_withdrawn`; bid 5 → `same_score`; counter 4; bid 5 → ok.
  - withdraw keeps the other brother's bid open; withdraw twice → `no_bid`.
  - turn down two bids → both `closed`, task `proposed`, same score, `offerRound` +1, open giver row by the turning-down giver, one audit `task.bids_turned_down` naming both entry ids; any brother's previous number is allowed again.
  - Review Focus 3: giver loads (seen = [starsi 25]); mladsi bids 22; turn down with seen → `offer_changed`, both bids still open, no audit row.
  - Review Focus 4: after a turn-down, `approveTaskOffer` by a brother → task `open` at the offer.
  - turn down with no bids → `no_bids`; on an open task → `not_proposed`.
  - `thread.test.ts`: `lastBids` resets after a giver row, keeps a closed bid.
  - `functions.test.ts`: switch off → `feature_off` for both (pattern of existing flag tests).
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3:** implement; `pnpm db:generate --custom --name bid_refusals_switch`, write the INSERT, `pnpm db:check`.
- [ ] **Step 4:** `pnpm test src/server` → PASS; `pnpm typecheck` clean.
- [ ] **Step 5:** commit "Withdraw and turn down bids on the server, behind bidRefusals".

### Task 3: Task page buttons

**Files:**
- Modify: `src/components/tasks/taskView.ts` (`BidCall` gains `withdrawBid` `{taskId}` and `turnDownBids` `{taskId, bids}`; `refuseButton(task, me, features)`; `sendButton` disabled rule), `src/components/tasks/bidCalls.ts`, `src/components/tasks/BidPanel.tsx` (gets `refusals: boolean` prop), `src/routes/_app/ukol/$taskId.tsx` (passes `features.bidRefusals`), `src/lib/strings.ts`, `src/components/tasks/TaskHistory.tsx` (labels for the two audit actions)
- Test: `src/components/tasks/bidPanel.test.tsx`, `src/components/tasks/bids.test.tsx`

**Interfaces:**
- `refuseButton(task: TaskView, me: Me, on: boolean): BidButton | null` — taker with an open bid → `withdrawBid`; giver with `task.bids.length > 0` → `turnDownBids` with `bids` = `task.bids` as shown; else / off / not proposed → null.
- `sendButton` for a taker: `disabled: value === task.score || value === lastBid` where `lastBid = task.lastBids.find(takerId === me.id)?.score`.

Copy (strings.ts, `cs.bids`):
- `withdraw: 'Nechci'`, `withdrawHint: 'Tvoje nabídka zmizí. Nabídnout můžeš znovu.'`
- `turnDown: 'Odmítnout nabídky'`, `turnDownHint: (score) => \`Všechny nabídky zmizí. Úkol zůstane navržený za ${score} b.\``
- `toast.withdrawn: 'Nabídka zrušena'`, `toast.turnedDown: 'Nabídky odmítnuty'`
- history (`cs.history` or where `task.bid_placed` is labelled): `bid_withdrawn: 'zrušil nabídku'`… use the existing label style of that file (verb phrase, gender-neutral like "Hotovo bez bodů": `'nabídka zrušena'`, `'nabídky odmítnuty'`).

Placement: the refuse button is the last row of the yes buttons (variant `ghost`), hint under it, before the stepper.

- [ ] **Step 1: Failing tests:** `refuseButton` — taker with bid / without / switch off; giver with bids sends exactly `task.bids` as `{takerId, score}`; giver no bids → null. `sendButton` taker: `lastBids [me 5]`, value 5 → disabled; `lastBids []`, open bid 5, value 5 → enabled. `BidPanel` render: Nechci shows with bid when `refusals`, hidden when not.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `pnpm test src/components` → PASS; `pnpm lint`, `pnpm typecheck`.
- [ ] **Step 5:** commit "Nechci and Odmítnout nabídky on the task page".

### Task 4: Seeds and e2e

**Files:**
- Modify: `src/server/demo/seeds.ts` (`bidRefusals` on in `demo` and `tasks`), `e2e/task-page.spec.ts`

- [ ] **Step 1:** e2e cases (tasks suite, "Umýt auto": Táta 18, Starší 25, Mladší 22):
  - Mladší taps Nechci → toast "Nabídka zrušena", his line gone, Starší's 25 stays.
  - Táta taps Odmítnout nabídky → toast "Nabídky odmítnuty", chip "Navrženo", no bids, score 18.
  - Order the cases so each starts from the state the previous left, or use a second seeded task (add one to the tasks piece if needed: "Vynést koš", Táta 6, Starší 8).
- [ ] **Step 2:** `pnpm build && pnpm exec playwright test e2e/task-page.spec.ts` → PASS.
- [ ] **Step 3:** screenshots for the UX judge (360×800 light): brother page with Nechci; parent page with Odmítnout nabídky.
- [ ] **Step 4:** commit "Seeds and e2e for bid refusals".
