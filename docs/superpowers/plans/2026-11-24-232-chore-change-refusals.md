# Chore price change: same number and a way to refuse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agreed chore's price change on `/sablona` follows the #208 bidding rules: a brother may not repeat his previous bid until a parent changed the offer, a brother can say Nechci, a parent can turn every bid down.

**Architecture:** The domain's template change (`src/domain/scoreChange.ts`) gets each taker's last bid (`lastBids`) and two new actions, `withdrawTemplateChangeBid` and `turnDownTemplateChangeBids`. The server's existing `withdrawTemplateBidIn` / `turnDownTemplateBidsIn` (proposed only today, #209) get their active branch. `priceView.ts` offers the no buttons and the same-number block on a running change. Nechci and turn-down sit behind the existing `bidRefusals` switch (the #208 switch for exactly these two buttons); the same-number rule is not switched, as in #208.

**Tech Stack:** TanStack Start, React, SQLite/Drizzle, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.1 (a template score change runs like §5.2 path 2, "including the same-number rule, a taker's no and a giver's turn-down", Jakub 2026-11-24) and §5.2 (Same number, A taker says no, A giver turns the bidding down). Issue #232.

**Size:** about 300 changed lines outside tests (domain ~70, server ~90, views and screens ~110, seed/e2e rows ~30). One PR: the server half alone shows nothing and its switch is already on in previews.

## Global Constraints

- Czech UI text only in `src/lib/strings.ts`; reuse `cs.bids.withdraw` (Nechci), `cs.bids.withdrawHint`, `cs.bids.turnDown` (Odmítnout nabídky), `cs.bids.toast.withdrawn`, `cs.bids.toast.turnedDown`, `cs.bids.sameAgainHint`, `cs.bids.turnDownChanged`. New: `cs.templatePrice.turnDownHint(score)` = `Všechny nabídky se uzavřou. Platí dál ${score} b.` (the old price stays; "zůstane navržený" of a Návrh is wrong here).
- No migration, no new switch: `bidRefusals` gates Nechci and the turn-down (server and screen). With it off, both actions answer `not_proposed` on an agreed chore, as today.
- Every state change writes its audit entry in the same transaction (`withAudit` style `writeAudit` in the action's tx), and an audit failure rolls the action back.
- A screen sends back exactly what it showed: the turn-down sends the bids seen; a stale list → `offer_changed` → `cs.bids.turnDownChanged`.
- Tap targets ≥ 44 px, 360 px layout with a ~30-letter chore name. No text field (stepper only), so no keyboard case.

## Rules this plan settles

1. **"Previous bid" floor (spec [call], §5.2 Same number).** A taker's previous bid is his newest bid (open, replaced or withdrawn) above the floor. The floor is the newest of: the newest giver row (a counter or a re-offer), the newest row a change agreement accepted (`closedAs = 'accepted'`), and the highest row id a turn-down closed (read from the newest `template.bids_turned_down` audit entry's `before.entryIds`). So a counter, a turn-down and an agreement each reset it; a Nechci does not.
2. **Turn-down with a parent offer:** every open bid closes and the giver re-offers the same number (a new giver row replaces the open one), like #208's re-issue: the change stays in flight at that offer and the floor moves.
3. **Turn-down when no parent has offered** (the change is only brothers' bids): every bid closes and nothing is left in flight; the chore keeps its price. Spec says "stays in flight at the current offer"; with no offer there is nothing to keep. This is asked to Jakub on a decision card; built this way meanwhile.
4. **Nechci that leaves nothing open** (his was the only row): the change ends; his withdrawn bid still counts as his previous bid until a floor event.

## Review Focus

1. Brother re-sends his withdrawn number after Nechci with no parent move: refused `same_score`, stepper greyed with `sameAgainHint`. Task 1 domain test + Task 3 view test.
2. After a parent's counter, the same number is fine again (5 → counter 7 → 5). Task 1 + Task 2 server test (floor = giver row).
3. Turn-down with no parent offer ends the change; a later bid at the old number starts a new change (floor = turn-down audit). Task 2 server test.
4. A turn-down sent with a stale bid list is refused and writes nothing. Task 2.
5. `bidRefusals` off: no Nechci / Odmítnout nabídky on an agreed chore's page, and both server calls answer `not_proposed`. Task 2 + Task 3 + e2e.

---

### Task 1: Domain — same number, Nechci, turn-down on a template change

**Files:**
- Modify: `src/domain/agreement.ts` (agreed variant gains `lastBids: readonly OpenBid[]`; every `{ status: 'agreed', … }` construction passes `lastBids: []`)
- Modify: `src/domain/scoreChange.ts`, `src/domain/templateBidding.ts` (its `back()` agreed result gets `lastBids: []`), `src/domain/index.ts` (exports)
- Test: `src/domain/scoreChange.test.ts`

**Interfaces:**
- Produces: `withdrawTemplateChangeBid(t: TemplateAgreement, people, takerId): Result<TemplateAgreement, AgreementError>`; `turnDownTemplateChangeBids(t, people, giverId, seen: readonly OpenBid[]): Result<TemplateAgreement, AgreementError>`; `bidTemplateScore` also refuses `score === lastBids[takerId]`.

- [ ] **Step 1: failing tests** in `scoreChange.test.ts`, `describe('template change: same number, Nechci, turn-down (#232)')`:
  - `bid refuses his last bid since the floor, open or withdrawn`: agreed 10, `lastBids: [{by: STARSI, score: 12}]`, no open bid → `bidTemplateScore(…, STARSI, 12)` = `same_score`; `MLADSI, 12` ok; `STARSI, 13` ok.
  - `Nechci closes only his bid`: change `{offer: {14, TATA}, bids: [STARSI 12, MLADSI 13]}` → result change bids `[MLADSI 13]`, offer kept; no open bid → `no_bid`; a giver → `not_a_taker`; not agreed → `not_agreed`.
  - `Nechci of the last row ends the change`: change `{offer: null, bids: [STARSI 12]}` → `change: null`.
  - `turn-down keeps the parent offer, closes every bid`: offer 14 + bids → `{change: {offer: {14, giverId}, bids: []}}` (offer now by the turning-down giver).
  - `turn-down with no offer ends the change`: → `change: null`, score unchanged.
  - `turn-down refuses a stale list, a taker, no bids`: seen differs → `offer_changed`; taker → `not_a_giver`; no live bids → `no_bids`; no change → `no_bids`.
- [ ] **Step 2:** `pnpm vitest run src/domain/scoreChange.test.ts` → FAIL (functions missing).
- [ ] **Step 3:** implement. Reuse `bidOf`, `liveTemplateBook`, and `sameTakers`-style key compare from `bidding.ts` (export it there as `sameBids(live, seen)` if not exported). Agreements return `lastBids: []`.
- [ ] **Step 4:** `pnpm vitest run src/domain` and `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(domain): same number, Nechci and turn-down on a chore price change (#232)`.

### Task 2: Server — floor, the two actions on an agreed chore, reads

**Files:**
- Modify: `src/server/templates/thread.ts` (`changeFloor(db, templateId): number`), `src/server/templates/templates.ts` (`agreementOf` agreed: `lastBids: lastBids(db, id, changeFloor(db, id))`; `TemplateView.lastBids` for an agreed chore, `[]` for a proposed one; `TemplateChangeView` unchanged), `src/server/templates/scoreChange.ts` (active branches of `withdrawTemplateBidIn` / `turnDownTemplateBidsIn`; `BiddingOpts` gains `bidRefusals: boolean`), `src/server/templates/functions.ts` (`bidding(db)` reads both switches)
- Test: `src/server/templates/changeRefusals.test.ts` (new), `src/server/templates/functions.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `withdrawTemplateBidIn(tx, takerId, templateId, now, opts)` and `turnDownTemplateBidsIn(tx, giverId, templateId, seen, now, opts)` work on an active template when `opts.bidRefusals`; audit actions `template.bid_withdrawn` (`before: {entryId, score}`) and `template.bids_turned_down` (`before: {score, entryIds, replacedOffer?}`, `after: {entryId}` only when re-offered). `TemplateView.lastBids: {takerId, score}[]`.

- [ ] **Step 1: failing tests** (`createTestDb`, demo family, an active template at 10):
  - `Nechci closes his bid, writes template.bid_withdrawn, others stay`.
  - `Nechci then the same number: same_score; after a counter: ok`.
  - `turn-down with an offer: bids closed, offer re-issued as a new giver row, same number ok after`.
  - `turn-down with no offer: change ends, template stays 10, a new bid at the old number starts a new change`.
  - `turn-down with a stale list writes nothing` (thread and audit row counts unchanged).
  - `an agreement resets the floor`: STARSI bids 12, giver accepts 12 → STARSI bids 12 in a new change? (template now 12 → `same_score` as the score; use 13: bid 13, accept, then bid 12 ok) — pins `accepted` rows as floor.
  - `audit failure rolls back` (trigger on `audit_log` for both actions).
  - `switch off: both answer not_proposed on an active chore` (`bidRefusals: false`).
  - `wrong actor`: giver withdraws → `not_a_taker`; taker turns down → `not_a_giver`.
  - functions.test: the two server functions pass `bidRefusals` from the flags; return shape `{ok, id, score, status}` pinned.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement. `changeFloor` = max(newest giver row id, max `accepted` row id, max of `before.entryIds` of the newest `template.bids_turned_down` audit for this template; 0). Turn-down with an offer re-uses `addEntry` for the giver row; no `offerRound` change on an active template.
- [ ] **Step 4:** `pnpm vitest run src/server/templates` + typecheck → PASS.
- [ ] **Step 5: Commit** `feat(templates): Nechci and turn-down on a chore price change (#232)`.

### Task 3: Screens — the no buttons and the same-number block on `/sablona`

**Files:**
- Modify: `src/components/templates/priceView.ts` (`priceRefusal(t, me, refusals = false)` also on `t.change`; `lastBid` reads `t.bidding?.lastBids ?? t.lastBids`; the active taker send is disabled at his last bid with `sameAgainHint`), `src/components/templates/TemplatePricePanel.tsx` (prop `refusals`), `src/routes/_app/sablona/$templateId.tsx` (passes `features.bidRefusals`), `src/lib/strings.ts` (`templatePrice.turnDownHint`)
- Test: `src/components/templates/priceView.test.ts`, `src/components/templates/pricePanel.test.ts`

- [ ] **Step 1: failing tests**:
  - `a brother with a bid in a change gets Nechci; refusals off: none`.
  - `a parent with bids gets Odmítnout nabídky sending exactly the bids shown, hint "Všechny nabídky se uzavřou. Platí dál 10 b."`; no bids → none.
  - `a brother's stepper is greyed at his last bid with sameAgainHint, open at the other brother's`.
  - `toasts: withdraw → Nabídka stažena, turnDown → Nabídky odmítnuty, a stale turn-down → turnDownChanged`.
  - panel: renders the ghost refusal button only with `refusals`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `pnpm vitest run src/components` → PASS.
- [ ] **Step 5: Commit** `feat(templates): Nechci and Odmítnout nabídky on a chore price change (#232)`.

### Task 4: Demo, e2e, screenshots

**Files:**
- Modify: `src/server/demo/pieces.ts` (piece `choreChange`: active "Vyndat myčku" stays as in `templates`; new active "Umýt koupelnu" at 8 with Starší's bid 10 and Mladší's bid 11, no parent offer), `src/server/demo/seeds.ts` (add to `demo`; seed `chorechange`: pieces `[choreChange]`, features `['recurring', 'bidRefusals']`), `src/server/demo/seed.test.ts`, `src/server/demo/demo.test.ts`, `src/server/demo/suites.test.ts`
- Create: `e2e/chore-change.spec.ts`; Modify: `e2e/suites.ts` (row `chorechange`)
- [ ] **Step 1: e2e** (360 px): (1) Starší opens Umýt koupelnu, taps Nechci → toast Nabídka stažena, his 10 uzavřeno, stepper at 10 greyed; Táta taps Odmítnout nabídky → toast Nabídky odmítnuty, chip Platí 8, no change in flight. (2) Switch off: the `recurring` suite (no `bidRefusals`) — Táta's page on "Vyndat myčku" (change in flight in `templates`) shows no Odmítnout nabídky; Mladší's shows no Nechci.
- [ ] **Step 2:** `pnpm test`, typecheck, lint, `pnpm build`, `pnpm exec playwright test --project chorechange --project recurring --trace off` → PASS.
- [ ] **Step 3:** screenshots 393×852 @3x and 360×800, long chore name (screenshot-only DB rename): brother with his bid in a change, after Nechci (greyed same number), parent with bids (refusal), after turn-down with an offer (offer stays), after turn-down without an offer (Platí only).
- [ ] **Step 4: Commit** `feat(demo): a chore price change with two bids, e2e (#232)`.
