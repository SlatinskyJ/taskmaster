# Refuse a stale first-price call on a chore that went active — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** #243 Refuse a stale first-price call on a chore that went active.

**Goal:** A bid, counter or accept a person sent while the chore was proposed (first-price bidding, #209) is refused as stale (`offer_changed`) when the chore turned active before the call landed, instead of running as a price-change call on the active chore. The same in the other direction.

**Architecture:** The client sends the status it saw (`seenStatus: 'proposed' | 'active'`) with every bid, counter and accept on a chore. `byStatus` in `src/server/templates/scoreChange.ts` refuses with `offer_changed` when `seenStatus` is given and differs from the row's status, before any rule runs (the same place and shape as the `seenDescription` check, #207 ruling 8). A call without `seenStatus` (demo seed, older callers) runs as today.

**Tech Stack:** TanStack Start server functions, Drizzle/SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.2 (an accept carries the number seen; a moved offer is refused), §5.2 "Bidding on a proposed template" (Jakub 2026-11-24), template score change (§5.2, Jakub 2026-11-17).

**Size:** about 40 changed lines outside tests (parser, `byStatus`, 4 handlers, `priceView.ts`). One PR.

## Global Constraints

- Every state change writes its audit entry in the same transaction; a refused call writes nothing (no thread row, no audit entry, score and status unchanged).
- Czech text only in `src/lib/strings.ts`; this change adds none: `offer_changed` already maps to `cs.tasks.errors.offerChanged` (`src/lib/taskErrors.ts`).
- No schema or migration change.

## Review Focus

1. A parent's counter at exactly an open bid, sent while proposed, landing after a brother's Souhlasím made the chore active → refused `offer_changed`, no price-change thread opened (the case of #243).
2. A brother's bid sent while proposed, landing after the chore went active → refused, no price-change bid.
3. A brother's accept of the offer (`acceptOffer`) sent while proposed, after active → refused, score unchanged.
4. A parent's accept of the lowest bid sent while proposed, after active → refused.
5. A malformed `seenStatus` (`'done'`, `1`) → validator throws (`invalid`), as for other malformed fields; a missing one runs as before.

---

### Task 1: Server refuses a status that moved

**Files:**
- Modify: `src/server/templates/parse.ts` (new `seenStatusOf`, used by `parseSeenScore`; new `parseSeenApproval` for counter and accept-bid)
- Modify: `src/server/templates/scoreChange.ts` (`ActionOpts`, `byStatus`)
- Modify: `src/server/templates/functions.ts` (the four handlers pass `seenStatus`; `counterTemplateScoreFn` and `acceptTemplateBidFn` validate with `parseSeenApproval`)
- Test: `src/server/templates/proposedBidding.test.ts`, `src/server/templates/functions.test.ts`, parse tests next to `parse.ts` (existing file if any, else `src/server/templates/parse.test.ts`)

**Interfaces:**
- Produces: `type ActionOpts = BiddingOpts & { seenDescription?: string | null; seenStatus?: TemplateStatus }`
- Produces: `seenStatusOf(body: Record<string, unknown>): { seenStatus?: TemplateStatus }` — `undefined` → `{}`; one of `TEMPLATE_STATUSES` → `{ seenStatus }`; anything else → `invalid()`.
- Produces: `parseSeenScore(data)` now also returns `seenStatus?`; `parseSeenApproval(data): { templateId; score; seenStatus? }`.
- Handlers: `bidTemplateScoreHandler`, `acceptTemplateOfferHandler` take `Seen & { seenStatus? }`; `counterTemplateScoreHandler`, `acceptTemplateBidHandler` take `Score & { seenStatus? }`; each adds `seenStatus: data.seenStatus` to the opts it passes.

- [ ] **Step 1: Failing domain-path tests** in `proposedBidding.test.ts`, each on a proposed chore with `choreBidding` on, made active by a brother's `approveTemplateScore` first:
  - `counter at an open bid with seenStatus 'proposed' after the chore went active → offer_changed`: Starší bids 6, Mladší agrees at the offer (chore active at the offer), Táta `counterOnTemplate(…, 6, now, { ...ON, seenStatus: 'proposed' })` → `{ ok: false, error: 'offer_changed' }`; the template's open thread rows, `score`, `status` and the audit log count are unchanged.
  - the same for `bidOnTemplate` (Mladší bids 7), `acceptOfferOnTemplate`, `acceptLowestBidOnTemplate` → each `offer_changed`, nothing written.
  - `seenStatus 'active' on a proposed chore → offer_changed` (one call is enough: a bid).
  - `seenStatus matching → runs`: on the proposed chore, a bid with `seenStatus: 'proposed'` is placed; on an active chore a counter with `seenStatus: 'active'` opens the change as today.
  - `no seenStatus → as before`: the counter of the first case without `seenStatus` still opens a price change (pins today's behaviour for callers that send none).
- [ ] **Step 2:** `pnpm vitest run src/server/templates/proposedBidding.test.ts` → the new refusal tests FAIL (the call runs).
- [ ] **Step 3:** Add `seenStatus` to `ActionOpts`; in `byStatus`, right after the `seenDescription` check: `if (opts.seenStatus !== undefined && opts.seenStatus !== ctx.row.status) return fail('offer_changed')`. Update the file's header comment (who may call what) with one line on it.
- [ ] **Step 4:** Rerun → PASS.
- [ ] **Step 5: Failing parse and handler tests:**
  - parse: `seenStatusOf({})` → `{}`; `{ seenStatus: 'proposed' }` → `{ seenStatus: 'proposed' }`; `'active'` likewise; `'done'`, `1`, `null` → throws. `parseSeenScore` and `parseSeenApproval` carry it through; `parseSeenApproval` still refuses what `parseApproval` refuses.
  - `functions.test.ts`, one per handler, each on a chore that went active after the call's page was drawn, each `{ ok: false, error: 'offer_changed' }` and nothing written: `counterTemplateScoreHandler(db, tata, { templateId, score: 6, seenStatus: 'proposed' }, now)`, `bidTemplateScoreHandler` (Mladší, 7), `acceptTemplateBidHandler` (Táta, the lowest bid he saw), `acceptTemplateOfferHandler` (a brother who bid, the offer he saw). Each proves its handler passes `seenStatus` on.
- [ ] **Step 6:** Rerun → FAIL. Implement `seenStatusOf`, `parseSeenApproval`, the handler opts, and the two validators. Rerun → PASS.
- [ ] **Step 7:** `pnpm typecheck && pnpm lint && pnpm vitest run src/server/templates` → green. Commit `Refuse a first-price call whose chore status moved (server)`.

`approveTemplateScoreFn` (Souhlasím) is not one of these four: it goes through `approveTemplateScoreIn`, which already refuses an active chore (`not_proposed`). It would accept `seenStatus` through `parseSeenScore` and ignore it; the client never sends it there (Task 2).

### Task 2: The chore page sends the status it showed

**Files:**
- Modify: `src/components/templates/priceView.ts` (`firstPriceButtons`, `priceButtons`, `firstPriceSend`, `priceSend`: every bid, counter, acceptBid and acceptOffer `data` gets `seenStatus: t.status`; the taker's `approve` data does not; the `priceToast` comment that says a late call "runs as a score change" now says it is refused as `offer_changed`)
- Test (e2e): `e2e/chore-bidding.spec.ts` (new last test, through the real routes and server functions)
- Modify: `src/components/templates/priceCalls.ts` only if its data types need the field
- Test: the existing `priceView` unit test file (`src/components/templates/*priceView*.test.ts`)

**Interfaces:**
- Consumes: `seenStatus` accepted by the four server functions (Task 1).

- [ ] **Step 1: Failing tests:** for a proposed chore, the taker's bid send data, the giver's accept-bid button data and counter send data each `toMatchObject({ seenStatus: 'proposed' })`, and the taker's approve button data has no `seenStatus` key; for an active chore with a change, the taker's accept-offer button and bid send, the giver's accept-bid button and counter send, each `{ seenStatus: 'active' }`. Existing exact-equality expectations on `data` are updated to include the field (not loosened).
- [ ] **Step 2:** Run → FAIL. Add the field. Run → PASS.
- [ ] **Step 3:** `pnpm typecheck && pnpm lint && pnpm test` → green. Commit `Chore page sends the status it showed with each price call`.
- [ ] **Step 4: e2e, the #243 case end to end** (last test in `e2e/chore-bidding.spec.ts`, `chores` seed, after the two existing tests; "Zalít kytky" is then proposed at 4 with its bids closed): `'Táta's counter at a bid is refused once a brother agreed the chore meanwhile (#243)'`.
  - Mladší (page A) bids 6 on "Zalít kytky" from its page.
  - Táta (page B) opens "Zalít kytky" and sees Mladší's bid 6; he steps the number to 6 so the send button reads `cs.templatePrice.acceptBid(6, 'Mladší')`, and does not tap yet.
  - Starší (page C) taps Souhlasím on "Zalít kytky" on his Domů → `cs.tasks.approved`; the chore is active at 4.
  - Táta taps the send button on page B → `cs.tasks.errors.offerChanged` is visible; after `page.reload()` the page shows `cs.templatePrice.now(4)`, and no `Přijmout` button or open price change.
  - Without Task 1 this test fails (the counter opens a price change at 6), which proves the field travels through the real validators of `counterTemplateScoreFn`.
- [ ] **Step 5:** Run it and the suites that use these buttons: `pnpm build && pnpm e2e --project chores --project chorechange --project recurring --project rows` → green. Commit.

No screen changes: the refused call already toasts `cs.tasks.errors.offerChanged` and reloads (`#242`). No `preview` label.
