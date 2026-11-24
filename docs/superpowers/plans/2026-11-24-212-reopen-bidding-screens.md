# Reopen bidding: screens (#212, PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A brother or parent can reopen bidding on a free one-time task from its page, and everybody can bid, counter, say yes, say no and end the round there, seeing only this round's offers and bids.

**Architecture:** PR 1 (#234) built the round on the server: `tasks.bidding_from`, domain state `rebidding`, `reopenBiddingFn`, and every bidding action working in a round. This PR exposes the round in `TaskView` (`rebidding`), shows only this round's thread rows on the task page, teaches the framework-free screen helpers (`src/components/tasks/taskView.ts`) the round, adds the reopen button where "Změnit cenu" was, a demo piece, a seed and an e2e suite. No schema or domain change.

**Tech Stack:** TanStack Start, React, Drizzle/SQLite, Vitest (static markup only, no DOM lib), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.2 "Reopening bidding on an open one-time task" (from #225).

## Global Constraints

- Czech UI text only in `src/lib/strings.ts`; code, identifiers and logs in English.
- Everything new stays behind the `reopenBidding` switch (`features.reopenBidding`); with it off the task page is exactly as today.
- A round's turn-down goes through `turnDownBidsFn`, which needs `bidRefusals` on as well; the new seed turns on both.
- "Bids of earlier rounds stay in the history and the log but are not shown on screen" (spec §5.2).
- "While the bidding runs, the task stays open at its agreed score: anyone may still reserve or complete it at that score."
- A screen sends back exactly what it showed; the server re-checks every call.
- Form screens: a case in `e2e/keyboard.spec.ts` and keyboard-open screenshots (CLAUDE.md).
- Brief screenshots: 393×852 @3x, never full page; plus 360 px checks for the UX judge.
- Ruling (spec §5.2 "stay in the history and the log but are not shown on screen"): earlier rounds' rows are hidden in the Vyjednávání thread; the Historie list keeps its lines (it is "the history"). Asked Jakub on a card; the e2e check is scoped to the thread section either way.
- `reopenBidding` and `bidRefusals` go on together in production: without `bidRefusals` a parent has no button to end a round.

## Review Focus

1. A round that ended (agreed or turned down): the thread keeps showing only that last round, not the rows before it. Pinned in Task 1 (`threadFrom` after the round ends).
2. A brother's yes in a round must send the counter's score, not the agreed `task.score`; else the server says `offer_changed`. Pinned in Task 2.
3. A round with no counter: no Souhlasím for brothers (nothing to agree to; taking it at the old price is Rezervovat). Pinned in Task 2.
4. With `reopenBidding` on but no round: no reopen button while a Jiná cena is pending (the server refuses `change_pending`), none on reserved, proposed, done or recurring tasks, none for the admin. Pinned in Task 2.
5. A parent's stop with no bids gets its own label and toast, not "Odmítnout nabídky" / "Nabídky odmítnuty". Pinned in Task 2.
6. A bid, a counter nobody bid at, or a Nechci in a round leaves the task `open`: the toast must not say "Domluveno". Pinned in Task 2.
7. A task reopened twice: after the second round ends, only the second round's rows show. Pinned in Task 1.

---

### Task 1: The round in `TaskView` and the task detail

**Files:**
- Modify: `src/server/tasks/tasks.ts` (`TaskView`, `views`, `getTaskDetail`, `listBidsToAnswer`)
- Modify: `src/server/tasks/thread.ts` (new `threadFrom`)
- Test: `src/server/tasks/rebidding.test.ts`

**Interfaces:**
- Produces: `TaskView.rebidding: { offer: number; offeredBy: { id: number; name: string } | null } | null`, non-null only for an open task in a round. In a round `bids`, `lowest` and `lastBids` are filled as for a proposed task (from the `rebidding` agreement); `approvedBy`, `approverIds`, `waitingFor` stay empty (a round keeps no approvals); `score` stays the agreed score.
- Produces: private `threadFrom(db: Db | Tx, task: TaskRow): number` in `tasks.ts` next to `getTaskDetail` (it reads the audit log, not thread rows): `task.biddingFrom` when a round runs, else the `biddingFrom` of the task's newest (highest id) `task.bidding_reopened` audit entry (`entityLog(db, 'task', id)`, field `after.biddingFrom`), else 0. `getTaskDetail` returns only thread rows with `id > threadFrom`.
- Produces: `listBidsToAnswer` also returns tasks with `status = 'open' AND bidding_from IS NOT NULL` and at least one open bid (giver home "Vyjednávání"), still oldest first.
- Readers of the changed fields: every list goes through `views`, so `listBoard` (TakerBoard, TaskGroups), `listTasks` (Úkoly) and `listPlanTasks` (MeetingScreen) get round bids too. They stay as they are on purpose apart from the chip (Task 2): TaskGroups and MeetingScreen show `lowestText` whenever `lowest` is set, so a round row reads "Mladší chce 15" next to "Vyjednává se" (consistent, no code change); their actions stay on `status === 'proposed'` and the row links to the task page, where the round is answered. The `TaskView` doc comments of `bids`, `lowest`, `lastBids` change from "Proposed only" to "Proposed, or open in a reopened round".
- Docs: `src/server/audit/README.md` lists `task.bidding_reopened` `after.biddingFrom` among the `after` keys code reads.

- [ ] **Step 1: Write the failing tests** in `rebidding.test.ts`, `describe('the round on screen')`:
  - `'a round shows in the view: offer by nobody, no bids'`: after `reopenBidding`, `getTaskDetail(...).task.rebidding` equals `{ offer: 18, offeredBy: null }`, `bids` `[]`, `score` 18.
  - `'a counter and bids show in the view'`: Mladší bids 15, Táta counters 16 → `rebidding` `{ offer: 16, offeredBy: { id: tata, name: 'Táta' } }`; Starší bids 14 → `bids` `[{ takerId: starsi, name: 'Starší', score: 14 }, …mladsi 15]`, `lowest.score` 14, `lastBids` holds both.
  - `'no round: rebidding is null'` on a plain open task and on a proposed one.
  - `'the thread shows only this round'`: the Návrh rows of `openCar` (id 1) are not in `getTaskDetail(...).thread` after reopen + a bid; the bid is.
  - `'after the round ends the thread still shows only that round'`: reopen, bid 15, Táta accepts lowest → task reserved, `thread` holds only the 15 row (`state: 'accepted'`). Same after a turn-down (`state: 'closed'`).
  - `'a task never reopened shows its whole thread'` (the Návrh row, as today).
  - `'reopened twice: only the second round shows after it ends'`: reopen, Mladší bids 15, Táta turns down; reopen again, Starší bids 14, Táta accepts lowest → `thread` holds only the 14 row.
  - `'listBidsToAnswer lists a round with a bid, not one without'`.
- [ ] **Step 2:** `pnpm vitest run src/server/tasks/rebidding.test.ts` → the new tests FAIL (`rebidding` undefined).
- [ ] **Step 3:** Implement `threadFrom`, the `rebidding` field and the round branch in `views` (`const bidding = agreement.status === 'proposed' || agreement.status === 'rebidding' ? agreement : null` for book and lastBids; `proposed` stays for offer/approvals), the filter in `getTaskDetail`, and `listBidsToAnswer` over `status = 'proposed' OR bidding_from IS NOT NULL`.
- [ ] **Step 4:** `pnpm vitest run src/server/tasks` → PASS (existing `getTaskDetail` exact-shape tests get `rebidding: null`).
- [ ] **Step 5:** Commit `Show a reopened round in the task view`.

### Task 2: Screen rules for a round (`taskView.ts`, `bidCalls.ts`)

**Files:**
- Modify: `src/components/tasks/taskView.ts`, `src/components/tasks/bidCalls.ts`, `src/lib/strings.ts`, `src/components/tasks/WaitingForYou.tsx` (second `toastFor` caller), `src/components/tasks/TakerBoard.tsx` (row chip)
- Test: `src/components/tasks/taskView.test.ts`, `src/components/tasks/bidCalls.test.ts`

**Interfaces:**
- Consumes: `TaskView.rebidding` (Task 1); `reopenBiddingFn` (PR 1, `{ data: { taskId } }` → `RefusalResult`).
- Produces: `BidCall` gains `{ action: 'reopenBidding'; data: { taskId: number } }`; `BID_CALLS.reopenBidding = reopenBiddingFn`; `callBid` handles it.
- Produces: `negotiating(task): boolean` = `status === 'proposed' || rebidding !== null`; `offerScore(task): number` = `rebidding?.offer ?? score`.
- Produces: `reopenButton(task, me, on: boolean): BidButton | null`: only with `on`, `origin === 'one_time'`, `status === 'open'`, `rebidding === null`, `scoreChange === null`, `me.role` giver or taker. Label `cs.rebid.reopen`, hint `cs.rebid.reopenHint(task.score)`, variant `ghost`.
- Changes (round only; proposed behaviour unchanged):
  - `taskChipState`: a round → `'negotiating'`. `TakerBoard.tsx:61` uses `taskChipState(task)` instead of the hard-coded `"open"`, so a brother's Domů Volné row says "Vyjednává se" during a round.
  - `bidButtons`: in a round a brother gets no buttons when `rebidding.offeredBy === null`; with a counter, the proposed layout with `score: rebidding.offer` (Souhlasím with hint `cs.rebid.approveHint(offer)`, and "Beru za {offer}" when he has a bid). The `approverIds` check is skipped (no approvals in a round). Giver: accept lowest, as today.
  - `sendButton`: works in a round; `disabled` and `again` compare with `offerScore(task)`.
  - `refuseButton`: in a round a brother's Nechci as today; a parent gets "Odmítnout nabídky" with hint `cs.rebid.turnDownHint(task.score)` when there are bids, and `cs.rebid.stop` / `cs.rebid.stopHint(task.score)` with `bids: []` when there are none.
  - `toastFor(call: BidCall, status, me, round = false)`: `reopenBidding` → `cs.rebid.toast.reopened`; `turnDownBids` with empty `bids` → `cs.rebid.toast.stopped`, else `cs.bids.toast.turnedDown`; both before the status checks. With `round` true (the task was in a round when tapped) the call decides, as the task stays `open` whether agreed or not: `placeBid` → `sent`, `withdrawBid` → `withdrawn`, `counterOffer` with empty `bidders` → `sent`; every other call (a yes, accept lowest, a counter at a bid number) → `agreedMine` when `reserved` for a taker, else `agreed`. With `round` false the status rules stay as today.
- Strings, `cs.rebid` (exact copy):
  - `reopen: 'Vyjednat novou cenu'`
  - `reopenHint: (score) => \`Dokud se nedomluvíte, platí ${score} b. Kdo úkol mezitím vezme, vyjednávání ukončí.\``
  - `turnDownHint: (score) => \`Všechny nabídky se uzavřou. Dál platí ${score} b.\``
  - `approveHint: (score) => \`Platí nová cena ${score} b. Úkol zůstane volný.\``
  - `offer: (name, score) => \`${name} nabízí ${score} b\`` (header line in a round with a counter)
  - `stop: 'Ukončit vyjednávání'`, `stopHint: (score) => \`Dál platí ${score} b.\``
  - `noEntries: 'Zatím žádná nabídka.'`
  - `toast: { reopened: 'Vyjednávání otevřeno', stopped: 'Vyjednávání ukončeno' }`

- [ ] **Step 1: Write the failing tests** in `taskView.test.ts`, `describe('a reopened round')`, with a fixture `round(offer, offeredBy, bids)` on an open one-time task at 18:
  - chip `'negotiating'`; a plain open task stays `'open'`.
  - no counter: `bidButtons(round(18, null, []), STARSI)` → `[]`.
  - counter 16 by Táta: Starší without bid → one `approveOffer` with `data.score` 16; with his bid 15 → `acceptOffer` 16 then `approveOffer` 16.
  - `sendButton(round(16, tata, []), STARSI, 16).disabled` true, at 18 false; his last bid 15 → at 15 `disabled` true with `sameAgainHint`.
  - giver: `sendButton(..., TATA, 17).action` `'counterOffer'`; with Mladší at 15 → accept-lowest button `data` `{ score: 15, bidders: [mladsi] }`.
  - `refuseButton(round(18, null, []), TATA, true)` → label `cs.rebid.stop`, `data.bids` `[]`; with a bid → `cs.bids.turnDown` + `cs.rebid.turnDownHint(18)`; switch off → null.
  - `reopenButton`: open one-time, giver and taker → label `cs.rebid.reopen`; null for admin, switch off, a round, a pending `scoreChange`, `reserved`, `proposed`, `confirmed`, `origin: 'on_demand'`.
  - `toastFor(turnDown(bids 1), 'open', TATA, true)` → `turnedDown`; `turnDown([])` → `stopped`; reopen → `reopened`; in a round: `placeBid` → `sent`, `withdrawBid` → `withdrawn`, `counterOffer` with `bidders: []` → `sent`, with `[mladsi]` → `agreed`, `acceptOffer` → `agreedMine` (reserved, taker); a proposed `placeBid` still → `sent` and a proposed `approveOffer` left proposed → `cs.tasks.approved`.
  - Souhlasím in a round: hint `cs.rebid.approveHint(16)`.
  - `bidCalls.test.ts`: `callBid({ action: 'reopenBidding', data: { taskId: 3 } })` reaches `reopenBiddingFn` with that data (existing mock pattern).
- [ ] **Step 2:** `pnpm vitest run src/components/tasks/taskView.test.ts src/components/tasks/bidCalls.test.ts` → FAIL.
- [ ] **Step 3:** Implement the helpers and strings above, and update both `toastFor` callers (`BidPanel` passes `task.rebidding !== null`; `WaitingForYou` lists proposed tasks only, passes the call and `false`).
- [ ] **Step 4:** Same command → PASS; `pnpm typecheck`.
- [ ] **Step 5:** Commit `Teach the bidding screens a reopened round`.

### Task 3: The task page

**Files:**
- Create: `src/components/tasks/ReopenBidding.tsx`
- Modify: `src/routes/_app/ukol/$taskId.tsx`, `src/components/tasks/BidPanel.tsx`, `src/components/tasks/BidThread.tsx`
- Test: `src/components/tasks/taskPage.test.tsx` (static markup)

**Interfaces:**
- Consumes: Task 2 helpers.
- Produces: `ReopenBidding({ task, me, on }: { task: TaskView; me: Me; on: boolean })`: renders `reopenButton` as a ghost button with its hint under it (the `BidPanel` yes-button layout), calls `callBid` through `useTaskAction`, toast from `toastFor`. Renders nothing when `reopenButton` is null.
- Page changes: `ReopenBidding` sits where `ScoreChangePanel` is, for one-time tasks, with `on={features.reopenBidding}`. In a round the header card gets `cs.rebid.offer(name, offer)` when a parent countered ("Táta nabízí 16 b") and the line `cs.taskPrice.oldStays(task.score)` ("Dokud se nedomluvíte, platí 18 b."). `BidThread` gets `empty?: string` and shows it as a muted line when `entries` is empty; the page passes `cs.rebid.noEntries` in a round. `BidPanel`'s stepper starts at `myBid ?? offerScore(task)`; its `key` adds `rebidding?.offer`.

- [ ] **Step 1: Write the failing tests** in `taskPage.test.tsx` (render the components with fixtures, as the file does): `ReopenBidding` shows "Vyjednat novou cenu" and the hint for Starší on an open task, nothing with `on` false; `BidThread` with `[]` and `empty` shows "Zatím žádná nabídka."; `BidPanel` in a round with Táta's counter 16 shows "Souhlasím" with "Platí nová cena 16 b." for Starší and no Souhlasím with no counter; the header line "Táta nabízí 16 b" (helper `roundLines(task)` in `taskView.ts`, tested in `taskView.test.ts`, returns the header lines).
- [ ] **Step 2:** `pnpm vitest run src/components/tasks/taskPage.test.tsx` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same → PASS; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** Commit `Reopen bidding from the task page`.

### Task 4: Demo piece, seed and e2e

**Files:**
- Modify: `src/server/demo/pieces.ts` (piece `rebidding`), `src/server/demo/seeds.ts` (seed `rebid`; piece in `demo`), seed tests that list seeds/pieces
- Create: `e2e/rebidding.spec.ts`
- Modify: `e2e/suites.ts` (row `{ name: 'rebid', spec: 'rebidding.spec.ts', seed: 'rebid' }`, comment "Its own server: a round changes the task for good"), `e2e/launch.spec.ts` (switch off)

**Interfaces:**
- Produces: piece `rebidding`: "Vynést staré věci na půdu" offered by Táta at 12, agreed by Mladší's yes; Starší bids 14 in the Návrh first (so a hidden old row exists), then the round: Starší reopens, Mladší bids 15. A second task "Zamést chodník před domem", open at 6, never reopened (the reopen button). Real actions through `step(...)`, as the other pieces.
- Seed `rebid`: `{ pieces: [rebidding], features: ['reopenBidding', 'bidRefusals'] }`.

- [ ] **Step 1: Write the e2e test** `e2e/rebidding.spec.ts`:
  - `'Starší reopens a free task and Táta accepts his bid'`: Starší opens "Zamést chodník před domem", taps "Vyjednat novou cenu" → toast "Vyjednávání otevřeno", chip "Vyjednává se", "Zatím žádná nabídka."; picks 8, Nabídnout → his row "chceš 8"; logout; Táta opens it, taps the accept-lowest button (`cs.bids.acceptBid(8, 'Starší')`) → toast "Domluveno", the page shows Starší's reservation.
  - `'a brother's Domů shows the round'`: Mladší's Domů Volné row "Vynést staré věci na půdu" contains `cs.state.negotiating` ("Vyjednává se", the StateChip label).
  - `'the round shows only its own bids'`: Táta opens "Vynést staré věci na půdu": inside the Vyjednávání region the thread holds Mladší's 15 and not Starší's old 14 (`threadRow` pattern of bid-refusals.spec.ts, `/chce 14\b/` count 0 in that region only); "Ukončit vyjednávání" is not shown (there is a bid) but "Odmítnout nabídky" is; tapping it → "Nabídky odmítnuty", chip back to Volné at 12.
  - No keyboard case: `ScoreStepper` has no text field (CLAUDE.md's keyboard rule covers text fields).
  - Switch off: in `e2e/launch.spec.ts` (seed `launch`, every switch off), Starší opens the open, agreed "Umýt okna v obýváku i v ložnici" (no price change pending, so only the switch hides the button): "Vyjednat novou cenu" has count 0 and "Změnit cenu" is there.
- [ ] **Step 2:** `pnpm build && pnpm exec playwright test e2e/rebidding.spec.ts --trace off` → FAIL (no piece).
- [ ] **Step 3:** Add the piece, the seed, the `demo` entry, the suites row; update seed tests that list seeds or count demo rows.
- [ ] **Step 4:** `pnpm test`, then the e2e command again → PASS; `pnpm exec playwright test e2e/launch.spec.ts --trace off` → PASS.
- [ ] **Step 5:** Commit `Demo and e2e for reopened bidding`.

### Task 5: Screenshots

- [ ] Screenshots for the UX judge and the brief (393×852 @3x, light): free task with "Vyjednat novou cenu"; a fresh round (no entries); a round with Táta's counter as Starší sees it (header line, Souhlasím, Beru za); Táta in a round with bids (accept lowest, Odmítnout) and with none (Ukončit vyjednávání); the thread after a round ended; Starší's Domů and Táta's Úkoly with the "Vyjednává se" row. The same at 360 px wide with a long task name for the UX judge. Kept outside the repo.
- [ ] Brief notes: reopening is one tap, no confirm (anyone can end it: a parent's stop, or Rezervovat); the two switches go on together.

## Out of scope

- "Čeká na tebe" rows for a brother when a parent counters in a round (proposed tasks only today). Follow-up issue at build time.
- A separate word for closed rows of an ended round (same `uzavřeno` as #228).

## Size

About 300 changed non-test lines: view field and thread filter (~60), helpers (~90), components (~80), piece and seed (~40), strings (~15).
