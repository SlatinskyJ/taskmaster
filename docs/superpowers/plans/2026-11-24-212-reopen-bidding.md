# Reopen bidding on a free one-time task (server half) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (CLAUDE.md). Steps use checkbox (`- [ ]`) syntax.

**Issue:** [#212 Reopen bidding on a free one-time task](https://github.com/SlatinskyJ/taskmaster/issues/212)

**Goal:** Any brother or parent can reopen bidding on an open (Volné) one-time task. The task stays Volné at its agreed score while the new round runs; the round runs by the §5.2 bidding rules and ends in agreement (new score), a parent's turn-down (old score), or someone reserving / completing / cancelling the task.

**This PR is the server half (PR 1 of 2).** Domain, schema, server actions, the server function behind the new switch `reopenBidding`, and the history labels the new audit actions need. PR 2 (stacked on this one, own plan) adds the screens (reopen button replacing "Jiná cena" on open tasks, the round's thread on the task page), the seed piece and the e2e test. Same split as [#138](https://github.com/SlatinskyJ/taskmaster/issues/138) (server #147, screens #153). With the switch off in production, this PR changes nothing anyone sees.

**Architecture:** A new domain status `rebidding` next to `proposed` / `open` / `reserved` in `OneTimeAgreement`; the existing bidding functions accept both negotiating statuses. On the DB side the task row stays `status = 'open'` and a new nullable column `tasks.bidding_from` marks a running round: the id of the newest `task_thread` row at reopen time (0 if none). Rows with a higher id belong to the round; older rows are kept but are not part of it (Jakub 2026-11-24: "clean slate … they should stay in the database. It's just a display thing").

**Tech Stack:** TS strict, Drizzle/SQLite, TanStack Start server functions, Vitest.

**Spec:** §5.2 "Reopening bidding on an open one-time task" (spec PR [#225](https://github.com/SlatinskyJ/taskmaster/pull/225)) and the bidding rules above it ("Same number", "A taker says no", "A giver turns the bidding down", from [#208](https://github.com/SlatinskyJ/taskmaster/issues/208), PR [#228](https://github.com/SlatinskyJ/taskmaster/pull/228)). This PR is stacked on #228.

## Global Constraints

- Code, identifiers, audit actions in English; Czech only in `src/lib/strings.ts`.
- Every state change writes its audit entry in the same transaction (`writeAudit`).
- `src/domain/` stays framework-free.
- New launch switch `reopenBidding`: in `FEATURE_KEYS`, off in `NO_FEATURES`, on in `ALL_FEATURES` (so the `demo` seed and previews have it); seeded **off** by the migration. Only the reopen action is switched: with the switch off nobody can start a round, so the other actions never see one.
- Only one-time tasks (`origin = 'one_time'`). Instances never get bidding (§5.1).
- Never edit a committed migration. This PR adds `0028_*`; if another migration lands on `main` first, renumber this branch's own migration (memory rule: drop and regenerate, not edit).

## Decisions (rulings for the judges)

1. **Round marker = `tasks.bidding_from`** (nullable integer, no FK). `null` = no round. Set only on an `open` one-time task. A column instead of a marker row because a reopen by a brother has no giver offer to write, and the thread's `side = 'giver'` row means "the giver side's offer". `ALTER TABLE ADD COLUMN`, no table rebuild, safe on the live DB.
2. **The round's opening offer is the agreed score, offered by nobody** (`offer.by = null`). It is not a thing anyone can say yes to: taking the task at that score is just Rezervovat (which ends the round, decision 6). Only a parent's counter creates an offer a brother can accept or approve.
3. **Same rules as a Návrh** (spec): a brother bids (not the current offer, not his previous bid in this round); Nechci; a parent counters (a counter at exactly brothers' bids accepts them); a parent accepts the lowest bid; a brother with a bid accepts a parent's counter → reserved to him; a brother without a bid says yes to a parent's counter → open at that score. "Previous bid" = his newest bid since the newer of the round start and the newest giver row.
4. **A turn-down ends the round** (spec): every open row of the round closes `closed`, `bidding_from` back to null, the task stays open at its agreed score. It goes through `saveItem` with `endBidding` like every other round end (one writer of `bidding_from = null`). **Asked Jakub** whether it is allowed with no bids (the spec is silent; card in the project thread and on this PR, label `needs-jakub`). Built meanwhile with his recommended answer, yes: a parent's way to stop a round nobody bids in, or to take back his own counter; `seen` must still match the open bids (then `[]`). If he says no, the domain gets the `no_bids` check back for rounds (one line, one test flips).
5. **Agreement in a round** goes through the existing `agree()`: a new lifecycle step `markRebidAgreed(item, bid | null)` (open → open, or open → reserved via bid), the task's score set to the agreed score, `offer_round` +1 when the score changed, `bidding_from` null, the round's rows close (`accepted` for the agreed ones). Audit `task.bid_accepted` / `task.score_approved` and `task.agreed` as today (`before.status = 'open'`).
6. **Reserve / complete / cancel during a round ends it** ([call] in spec): `saveItem` closes the round's open rows and nulls `bidding_from` whenever an item leaves `open` while a round runs; `runStep` then writes `task.bidding_closed` (`after { entryIds }`) after the step's own entry, the same way it logs `task.score_change_discarded` (history reads cause, then effect). The ids also sit in the step's own `after.closed`; the separate entry is what the task page's history shows as its own line ("vyjednávání skončilo"), so a brother sees why his bid is gone.
7. **Reopening replaces "Jiná cena" on open tasks** (spec [call]). With the switch on, `proposeTaskScoreChange` on an **open** one-time task is refused (`not_changeable`) on the server, in this PR; reserved tasks keep "Jiná cena". The flag is read in the server function handler (`proposeTaskScoreChangeHandler`), so `scoreChange.ts` stays flag-free. Besides: reopening is refused while a score change is still open from before the switch (`change_pending`), and proposing one while a round runs is refused (`bidding_open`, also with the switch off, a round can outlive a switch flip). Hiding the button is PR 2.
8. **No approvals rows in a round.** `task_score_approvals` belong to the proposed state's path 1. In a round a counter is the parent's approval and one brother's yes completes it (§3: one giver + one taker), so nothing needs storing.
9. **`offer_round` does not move on reopen or counter in a round**; only when the agreed score changes (decision 5). Approvals of the old proposed rounds are keyed by round and can't be reused anyway.
10. **"Agreed" means `open | reserved` only.** `AgreedOneTime` becomes `Extract<OneTimeAgreement, { status: 'open' | 'reserved' }>` and a helper `isAgreedOneTime(a): a is AgreedOneTime` replaces every `status !== 'proposed'` / `=== 'proposed'` test on a domain result (`counterOffer`, `acceptOffer`, `acceptLowestTaskBid`, `approveTaskOffer`), so a plain counter in a round can never reach `agree()`. `agreementOf` returns `rebidding` only for a row with `status = 'open'` and `bidding_from` set; `reopenBidding` itself refuses any row that is not `open` before asking the domain (`not_changeable`), so reserved, done, confirmed and cancelled tasks can't be reopened.

**Size:** about 410 changed lines without tests and the migration (domain ~125, server ~210, functions ~45, schema / switch / strings ~30). Just over the 400 goal because the "agreed" helper (decision 10) and the server-side Jiná cena refusal (decision 7) belong with the rules they protect; screens are PR 2.

## Pre-flight

- Tests: each new or changed server action rolls back when its audit write fails (pattern: `failAuditOn` in `bidding.test.ts`); each action tried by the wrong actor; reopen through its server function with the switch on and off; `server-fn-guards.test.ts` lists the new function with its roles.
- Security: the new function needs a signed-in giver or taker (`requireRole('giver', 'taker')`), takes only `{ taskId }` (`parseTaskId`), and the domain re-checks the role live inside the transaction.
- UX: nothing a user sees changes in this PR (switch off in production; no screen calls the function yet). History labels only: two new `cs.history` strings.

## Review Focus

1. Reopen on an open task → task still `open`, same score, `bidding_from` set; a brother can reserve it at the old score, which closes the round and logs `task.bidding_closed`. Task 2.
2. Old thread rows are not part of the round: a brother who bid 5 in the original Návrh may bid 5 in the new round (same-number rule counts only this round); `listBids`/`openBids` of the round are empty after reopen. Task 2.
3. Round ends by agreement: parent accepts the single lowest bid 12 → task `reserved` to that brother via bid, score 12, `bidding_from` null, rows `accepted`/`closed`; a tie → `open` at 12. Task 2.
4. Parent counters 15, brother without a bid approves → `open` at 15; brother with a bid accepts → `reserved` to him at 15. Task 2.
5. Parent turns down (with or without bids) → `open` at the old score, round over, every round row `closed`. Task 2.
6. Reopen refused: proposed, reserved, done, confirmed, cancelled task, instance, round already running, open score change, switch off. Task 1 + Task 2 + Task 3.
7. A plain counter in a round (no bid at its number) leaves the task open at the old score, round running. Task 2.
8. Switch on: "Jiná cena" on an open task refused; on a reserved task still accepted. Task 3.

---

### Task 1: Domain

**Files:**
- Modify: `src/domain/agreement.ts` (variant `rebidding`, `reopenOneTimeBidding`, `resolveOneTime`, `approveOneTimeOffer`; errors `bidding_open`), `src/domain/bidding.ts` (every function accepts `proposed | rebidding`), `src/domain/lifecycle.ts` (`markRebidAgreed`), `src/domain/index.ts`
- Test: `src/domain/agreement.test.ts`, `src/domain/bidding.test.ts`, `src/domain/lifecycle.test.ts`

**Interfaces (produces):**
- `OneTimeAgreement` gains `| { status: 'rebidding'; score: number; offer: { score: number; by: PersonId | null }; book: BidBook; lastBids: readonly OpenBid[] }` — `score` is the agreed score that stays in force; `offer` the round's current offer (`by: null` = the agreed score, nobody's offer).
- `type Negotiating = Extract<OneTimeAgreement, { status: 'proposed' | 'rebidding' }>`; helper `offerScore(t: Negotiating): number`.
- `type AgreedOneTime = Extract<OneTimeAgreement, { status: 'open' | 'reserved' }>` and `isAgreedOneTime(a: OneTimeAgreement): a is AgreedOneTime` (moved here from `src/server/tasks/tasks.ts`, decision 10).
- `reopenOneTimeBidding(task, people, actorId): Result<OneTimeAgreement, AgreementError>` — `rebidding` → `bidding_open`; `proposed` → `not_agreed`; `reserved` → `not_changeable`; actor not an active giver or taker → `not_a_party`; else `{ status: 'rebidding', score, offer: { score, by: null }, book: EMPTY_BOOK, lastBids: [] }`.
- `placeOneTimeBid` / `withdrawOneTimeBid`: same rules on `rebidding` (same number against `offer.score` and `lastBids`); anything else → `not_proposed`.
- `counterOneTimeOffer` on `rebidding`: `same_score` when `score === offer.score`; at brothers' bids → `agreeAt` (reserved / open); else `{ ...task, offer: { score, by: giverId }, lastBids: [] }`.
- `acceptOneTimeOffer` on `rebidding`: `offer.by === null` → `no_offer`; else reserved to him with `giverId = offer.by` (giver must be active, else `not_a_giver`).
- `approveOneTimeOffer` on `rebidding`: approver must be an active taker (`not_a_taker`); `offer.by === null` → `no_offer`; else `{ status: 'open', score: offer.score }`.
- `acceptLowestBid` on `rebidding`: unchanged rule → `agreeAt`.
- `turnDownOneTimeBids` on `rebidding`: no `no_bids` check; `seen` must equal the live bids (`offer_changed`); result `{ status: 'open', score: task.score }`.
- `resolveOneTime` on `rebidding`: prunes the book (`liveBook`), never changes the status.
- `markRebidAgreed(item, bid: { takerId; giverId } | null): Result<Item, LifecycleError>` — `item.status !== 'open'` → `wrong_state`; `null` → open (same item); bid → reserved via bid.

- [ ] **Step 1: Failing tests.**
  - agreement: reopen open → rebidding at the agreed score, `offer.by null`, empty book; on proposed / reserved / rebidding / by admin → errors as above.
  - bidding, `describe('in a reopened round (#212)')`: bid ≠ offer ok; bid = agreed score (the offer) → `same_score`; bid, Nechci, same bid → `same_score`, after a counter ok; counter at a bid → reserved; counter 15 then a bidder accepts 15 → reserved with that giver; accept with `offer.by null` → `no_offer`; brother without bid approves the counter → open 15; giver approves → `not_a_taker`; lowest bid single → reserved, tie → open; turn-down with no bids and `seen []` → open at the old score; turn-down with a stale `seen` → `offer_changed`.
  - lifecycle: `markRebidAgreed` open → open / reserved via bid; proposed → `wrong_state`.
- [ ] **Step 2:** `pnpm test src/domain` → FAIL.
- [ ] **Step 3:** Implement. Keep each existing function's `proposed` path byte-for-byte the same (existing tests stay green unchanged).
- [ ] **Step 4:** `pnpm test src/domain` → PASS.
- [ ] **Step 5:** commit "Reopened bidding in the domain".

### Task 2: Schema, thread queries, server actions

**Files:**
- Modify: `src/server/db/schema/tasks.ts` (`biddingFrom: integer('bidding_from')`, nullable, doc comment = decision 1)
- Create: `drizzle/0028_<name>.sql` via `pnpm db:generate --name reopen_bidding`, then append `INSERT INTO feature_flags (key, enabled) VALUES ('reopenBidding', 0);` (before committing it)
- Modify: `src/lib/features.ts`, `src/server/features/README.md` (one line)
- Modify: `src/server/tasks/thread.ts` (`openOfferOrNull`, `lastBids(db, taskId, since = 0)`), `src/server/tasks/item.ts` (`saveItem` ends a round), `src/server/tasks/tasks.ts` (`agreementOf`, `agree`, `approveTaskOffer`), `src/server/tasks/bidding.ts` (`reopenBidding`; `counterOffer`, `acceptOffer`, `turnDownBids` round branches), `src/server/tasks/lifecycle.ts` (`runStep` logs `task.bidding_closed`), `src/server/tasks/scoreChange.ts` (refuse while a round runs), `src/server/audit/actions.ts` (`task.bidding_reopened`, `task.bidding_closed`)
- Test: `src/server/tasks/bidding.test.ts` (new `describe('reopened bidding (#212)')`), `src/server/tasks/thread.test.ts`, `src/server/tasks/lifecycle.test.ts`, `src/server/tasks/scoreChange.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `agreementOf(tx, task)`: `open` with `biddingFrom !== null` → `rebidding` with `offer` = the open giver row (`{ score, by: userId }`) or `{ score: task.score, by: null }`, `book` = open taker rows, `lastBids = lastBids(tx, id, biddingFrom)`.
  - `lastBids(db, taskId, since)`: floor = max(`since`, newest giver row id).
  - `reopenBidding(db, userId, taskId, now?): Result<TaskRow, TaskError>` — row `status !== 'open'` → `not_changeable` before the domain is asked (decision 10); refuses `change_pending` when a score change is open; one-time only (`not_changeable` for instances); sets `bidding_from` = newest thread row id of the task (0 if none); audit `task.bidding_reopened` `after { score, biddingFrom }`.
  - `counterOffer` in a round, not agreeing: `addEntry` a giver row (an older open counter closes `replaced`); the task row is not touched; audit `task.score_countered` `before { score: old offer, entryId: old row id or null }`, `after { score, entryId }`.
  - `turnDownBids` in a round: closes every open round row `closed` and nulls `bidding_from` through `saveItem(…, toItem(task), { endBidding: true })`; audit `task.bids_turned_down` `before { score: offer, entryIds, offerEntryId: id or null }`, `after { status: 'open', score: task.score }`.
  - `agree()` on an open task (a round): `markRebidAgreed`, `saveItem` with `{ score, agreedAt, offerRound, }` and `endBidding: true`; audit as today.
  - `counterOffer`, `acceptOffer`, `acceptLowestTaskBid`, `approveTaskOffer` branch on `isAgreedOneTime(result.value)` (decision 10).
  - `acceptOffer` / `approveTaskOffer` in a round: `score` must equal the round's offer (`offer_changed`); no approvals row; `approveTaskOffer` stops refusing `open` tasks only when a round runs.
  - `saveItem(tx, before, item, opts)`: when `before.biddingFrom !== null` and (`item.status !== 'open'` or `opts.endBidding`), it closes the open rows (`closeThread`, `accepted` = `opts.accepted`) and writes `bidding_from = null`.
  - `runStep`: if the step ended a round (`row.biddingFrom !== null && saved.biddingFrom === null`), writes `task.bidding_closed` `after { entryIds: closed }` after the step's entry.
  - `proposeTaskScoreChange`: `bidding_from !== null` → `bidding_open`.

- [ ] **Step 1: Failing tests** (`family()`, `car()` helpers; a helper `openCar(f)` that agrees the car task at 18):
  - Review Focus 1 + 2: reopen by Starší → `open`, 18, `biddingFrom` = last row id; Mladší bids 5 even though he bid 5 in the Návrh; `reserveTask` by Starší → reserved, round rows `closed`, `biddingFrom` null, audits end `task.reserved`, `task.bidding_closed`.
  - Review Focus 3: Starší 12 and Mladší 14, Táta accepts lowest → reserved to Starší via bid, score 12, `offerRound` +1, Starší's row `accepted`, Mladší's `closed`; tie at 12 → open 12.
  - Review Focus 4: counter 15 (task row still 18), Mladší approves 15 → open 15; Starší with a bid accepts 15 → reserved to Starší with Táta.
  - Review Focus 7: counter 15 with no bid at 15 → task `open`, score 18, `biddingFrom` unchanged, one open giver row, audit `task.score_countered`, no `task.agreed`.
  - Stale yes: counter 15, then counter 20; Mladší approves 15 → `offer_changed`; Starší (with a bid) accepts 15 → `offer_changed`; nothing written, round still running.
  - Old score: counter 15, then counter 18 (the agreed score), Mladší approves 18 → open 18, `offerRound` unchanged (decision 9).
  - Review Focus 5: turn-down with no bids → open 18, `biddingFrom` null, counter row `closed`; stale `seen` → `offer_changed`, nothing closes.
  - complete (by Starší) and cancel (by Táta) during a round with one open bid: each asserts the bid row `closed`, `biddingFrom` null, and the task's last two audit actions `task.completed` / `task.cancelled` then `task.bidding_closed` with `after.entryIds` = [that bid's id].
  - refusals: reopen on proposed (`not_agreed`), reserved, done (`done_unconfirmed`), confirmed and cancelled (`not_changeable`, `biddingFrom` stays null), an instance (`not_changeable`; built with the instance helpers in `testing.ts`), running round (`bidding_open`), open score change (`change_pending`), by admin (`not_a_party`); score change during a round → `bidding_open`.
  - rollbacks (one per new write path): `failAuditOn('task.bidding_reopened')` → `biddingFrom` still null; `'task.bidding_closed'` → reserve rolled back too; `'task.score_countered'` in a round → no new giver row; `'task.bids_turned_down'` in a round → bids open, `biddingFrom` set; `'task.agreed'` on a lowest-bid acceptance in a round → task open at 18, round running, rows open.
  - `thread.test.ts`: `lastBids` with `since` ignores rows at or below it; and with a giver row newer than `since` the floor is that giver row (bid 12, counter, bid 12 again is allowed) — the max of the two, not `since` alone.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement; generate the migration, append the INSERT, `pnpm db:check`.
- [ ] **Step 4:** `pnpm test src/server` → PASS; `pnpm typecheck` clean.
- [ ] **Step 5:** commit "Reopened bidding on the server".

### Task 3: Server function and history labels

**Files:**
- Modify: `src/server/tasks/functions.ts` (`reopenBiddingHandler`, `reopenBiddingFn`; `proposeTaskScoreChangeHandler` refuses an open task when `reopenBidding` is on, decision 7), `src/lib/taskErrors.ts` (`bidding_open` → `cs.tasks.errors.biddingOpen`), `src/lib/strings.ts` (`cs.tasks.errors.biddingOpen: 'Teď se o ceně vyjednává. Obnov stránku.'`, `cs.history.biddingReopened: 'nové vyjednávání o ceně'`, `cs.history.biddingClosed: 'vyjednávání skončilo'`), `src/components/tasks/historyText.ts` (two cases; a `task.bids_turned_down` entry without bids, `score` null in history, reads `biddingClosed` instead of "nabídky odmítnuty"; `taskHistory` passes `entryIds` length as needed)
- Test: `src/server/tasks/functions.test.ts`, `tests/server-fn-guards.test.ts`, `src/lib/taskErrors.test.ts`, `src/components/tasks/historyText.test.ts`

**Interfaces:**
- `reopenBiddingHandler(db, userId, { taskId }, now): RefusalResult` — `feature_off` when `getFlags(db).reopenBidding` is false, else `answered(reopenBidding(…))`.
- `reopenBiddingFn`: POST, `requireRole('giver', 'taker')`, `parseTaskId`.

- [ ] **Step 1: Failing tests:** switch off → `feature_off`, nothing written; on → `{ ok: true, … }` and the task has `biddingFrom`; Review Focus 8 (switch on: Jiná cena on open → `not_changeable`, on reserved → ok; switch off: open → ok); guard list entry `reopenBiddingFn: ['giver', 'taker']`; error and history text cases.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `pnpm test`, `pnpm typecheck`, `pnpm lint` → clean.
- [ ] **Step 5:** commit "Reopen bidding server function, behind reopenBidding".

### Task 4: Clean up

- [ ] Full `pnpm test`, `pnpm build`; delete this plan file in its own commit; brief (skill `pr-brief`; no screenshots: nothing on screen changes), PR ready **without** the `preview` label (backend only).
