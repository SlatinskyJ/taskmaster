# Chore first-price bidding: screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With switch `choreBidding` on, brothers and parents bid on a proposed recurring chore's first price from Domů and the chore's price page (/sablona), using the server half from PR #241.

**Architecture:** Server reads learn the switch: a brother may open a proposed chore's page, and a parent's "Vyjednávání" list takes a proposed chore with bids. `priceView.ts` (framework-free, unit-tested) decides the proposed chore's buttons from `TemplateView.bidding`; `TemplatePricePanel` renders them. Domů and Úkoly rows link to the page, mirroring a one-time Návrh. A demo piece and an e2e suite exercise it.

**Tech Stack:** TanStack Start, React, Vitest (static markup), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.1 (first-price bidding sentence, from PR #225) and §5.2 path 2; issue #209.

## Global Constraints

- Czech UI text only in `src/lib/strings.ts`; reuse `cs.bids.*` (Nabídnout, Chci jinou cenu, Nechci, Odmítnout nabídky, Odpovědět, Otevřít, Jiná cena) wherever the one-time Návrh uses them. New strings only where a chore differs.
- Switch off (production): every screen is exactly as today (no link on a proposed Úkoly row, Domů row only Souhlasím, a brother gets not found on a proposed chore's page). Pinned in `e2e/recurring.spec.ts` (recurring on, choreBidding off).
- A screen sends back exactly the number it showed (offer, lowest bid, seen bids); the server refuses a stale one.
- Tap targets ≥ 44 px (`min-h-tap`), layout holds at 360 px.
- Score stepper has no text field, so no keyboard case is needed (CLAUDE.md forms rule applies to text fields).

## Review Focus

1. A brother with an open bid on a proposed chore: Domů row says Otevřít (not Souhlasím + Jiná cena), as for a Návrh. Task 3 test.
2. A brother's Nabídnout is disabled on the offer and on his last bid (`bidding.lastBids`), with `sameAgainHint`. Task 2 test.
3. A parent's turn-down sends exactly the bids he saw (`bidding.bids` mapped to `{takerId, score}`); a bid arriving meanwhile shows `turnDownChanged`. Task 2 + e2e.
4. Switch off: a brother opening `/sablona/<proposed id>` gets not found, the parent's page and Úkoly row offer no bidding (`bidding: null`). Task 1 + recurring e2e.
5. Agreement from the page (accept lowest) leaves the page showing the chore as Platí at the new score with no panel left over. e2e.

---

### Task 1: Server reads follow the switch

**Files:**
- Modify: `src/server/templates/templates.ts` (`views`, every read that calls it, `getTemplateDetail`, `pendingTemplatePriceChanges`), `src/server/templates/functions.ts`
- Test: `src/server/templates/templates.test.ts`, `src/server/db/migrate.test.ts`

**Interfaces:**
- Produces:
  - `views(db, rows, opts: BiddingOpts)`: `bidding` is filled only with `opts.choreBidding`; off → `bidding: null` on every template, so a screen never offers bidding the server would refuse. `listTemplates`, `getTemplateDetail`, `pendingTemplatePriceChanges`, `pendingTemplateApprovals` take `opts = { choreBidding: false }` and pass it on; their server functions pass `{ choreBidding: getFlags(db).choreBidding }`.
  - `getTemplateDetail(db, templateId, viewerId, opts)`: with the switch on, a viewer whose role is `taker` may open a proposed template (today null). Admin still null.
  - `pendingTemplatePriceChanges(db, userId, opts)`: with the switch on, a giver's list also takes proposed templates with at least one live bid (`bidding.bids.length > 0`), oldest first, after the agreed ones. Taker list unchanged (he reaches a proposed chore through `pendingTemplateApprovals`).
  - `TemplateActionResult` gains `status: 'proposed' | 'active'` (the template's status after the action), so a screen can tell an agreement from a counter: on a proposed chore the offer is `templates.score`, so a counter returns the score it sent while still proposed.

- [ ] **Step 1: Failing tests:** templates.test `a proposed chore's view has bidding only with choreBidding on` (`listTemplates` and `getTemplateDetail` for Táta, off → `bidding: null`); `a brother opens a proposed chore's page only with choreBidding on; an admin never`; `a parent's Vyjednávání takes a proposed chore with bids only with the switch on` (fixture: an agreed chore with a bid, a proposed one with a bid, a proposed one without; on → `[agreed, proposed-with-bid]` in that order, off → `[agreed]`); functions.test `a counter on a proposed chore answers status proposed, an accept status active`; migrate.test `0029 keeps every template approval as offer round 1` (a template with two approvals written before 0029, read back after: both rows `offer_round` 1, template `offer_round` 1).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(templates): proposed chore reads follow choreBidding (#209)`

### Task 2: What a proposed chore's page offers

**Files:**
- Modify: `src/components/templates/priceView.ts`, `src/components/templates/priceCalls.ts`, `src/lib/strings.ts`
- Test: `src/components/templates/priceView.test.ts`, `src/components/templates/priceCalls.test.ts`

**Interfaces:**
- Produces:
  - `PriceCall` becomes a union: the four existing actions with `{ templateId, score }`, plus `{ action: 'approve'; data: { templateId, score } }` (`approveTemplateScoreFn`), `{ action: 'withdraw'; data: { templateId } }` (`withdrawTemplateBidFn`), `{ action: 'turnDown'; data: { templateId; bids: { takerId; score }[] } }` (`turnDownTemplateBidsFn`). `PRICE_CALLS` maps all seven.
  - On a proposed template with `bidding` (else every function answers as today):
    - `priceButtons(t, me)`: brother → `Souhlasím` approve at `bidding.offer.score`, hint new `cs.templatePrice.firstAgreeHint(n)` = "Úkol začne platit za {n} b."; parent with live bids → accept lowest (`acceptBid(lowest, names)` or `acceptTie(lowest)` on a tie), hint `firstAgreeHint(lowest)`; a parent who has not approved this round (`approvedBy` lacks his name) and no bids → Souhlasím approve, hint `firstAgreeHint(offer)`. The proposing parent (in `approvedBy`) gets no Souhlasím.
    - `priceRefusal(t, me): PriceButton | null`: brother with an open bid → Nechci (`withdraw`, hint `withdrawHint`); parent with live bids → Odmítnout nabídky (`turnDown` with exactly `bidding.bids` as `{takerId, score}`, hint `turnDownHint(offer)`); else null. Agreed templates → null.
    - `priceSend(t, me, value)`: brother → bid, disabled at the offer and at his `lastBids` score (hint then `sameAgainHint`); parent → counter, disabled at the offer; at exactly a live bid the label accepts it and names the bidders at that score (not the lowest), hint `firstAgreeHint(value)`.
    - `myTemplateBid`, `stepperStart`, `priceMeta` read one private `bookOf(t)` = `t.change ?? t.bidding` (the bidding view extends the change view), so each function has one branch, not two.
    - `priceToast(call, result, wasProposed)`: `withdraw` → `toast.withdrawn`, `turnDown` → `toast.turnedDown`; on a proposed chore `toast.agreed` only when `result.status === 'active'`, else `toast.sent` (a counter or a first approval); on an agreed chore as today.
    - `priceError(call)`: a `turnDown` answered `offer_changed` → `cs.bids.turnDownChanged`, else the usual message (as BidPanel's `refusalError`).
    - `templateChip`: proposed with live bids → `negotiating`; else as today.
- [ ] **Step 1: Failing tests** in priceView.test (a proposed `TemplateView` fixture at 10 by Táta; Starší bid 12): brother buttons (Souhlasím at 10, Nechci), brother send disabled at 10 and at his last bid 12 with `sameAgainHint`; Mladší (no bid) has no Nechci; parent buttons (Přijmout 12 (Starší), Odmítnout nabídky with bids `[{takerId: STARSI, score: 12}]`), tie label; second parent with no bids and no approval → Souhlasím; parent send at 12 = accept label naming Starší, at 14 with Mladší's bid 14 = accept label naming Mladší; Táta (proposer, no bids) has no Souhlasím; chip `negotiating` with bids, `proposed` without; `bidding: null` on a proposed template (the switch-off read Task 1 pins) → no buttons, no refusal, no send; priceToast on a proposed chore: counter `{status: 'proposed', score: 11}` → sent, approve `{status: 'proposed'}` → sent, accept `{status: 'active'}` → agreed; priceError turnDown offer_changed → turnDownChanged. priceCalls.test: the three new actions call their server functions with exactly `data`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(templates): what a proposed chore's price page offers (#209)`

### Task 3: Screens

**Files:**
- Modify: `src/components/templates/TemplatePricePanel.tsx` (render `priceRefusal` under the yes buttons, as BidPanel does for a Návrh), `src/routes/_app/sablona/$templateId.tsx` (proposed: header line `cs.templatePrice.proposedNow(score)` = "Návrh: {n} b."; no `futureOnly` line), `src/components/tasks/WaitingForYou.tsx` (template approval row with `bidding`: chip from `templateChip`, short line from `priceMeta` (e.g. "Táta nabízí 10" or his own bid), Souhlasím + `Jiná cena` link; Otevřít link when he has a bid, same shape as `taskActions`; without `bidding` exactly as today), `src/components/templates/TemplateRow.tsx` (proposed row with `bidding` links to its page: `Odpovědět` with bids, else `Otevřít`; with bids its short line is `priceMeta`, not "Čeká na souhlas"). Screens key off `bidding` (null with the switch off, Task 1), so no extra prop.
- Test: `src/components/templates/pricePanel.test.tsx`, `src/components/templates/templatePage.test.tsx`, `src/components/tasks/homePage.test.tsx`, `src/components/tasks/tasks.test.tsx`

- [ ] **Step 1: Failing tests:** pricePanel `a brother on a proposed chore sees Souhlasím, Nechci and the stepper`; `a parent sees Přijmout, Odmítnout nabídky`; templatePage `a proposed chore shows Návrh: 10 b. and no future-only line`; homePage `a brother's proposed chore row: Souhlasím + Jiná cena with bidding, Otevřít and his bid in the short line with his bid, only Souhlasím and Opakovaný with bidding null`; tasks.test `a parent's proposed Úkoly row links to its page only with bidding; with bids it shows the lowest bid, not Čeká na souhlas`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(templates): bid on a proposed chore from Domů and its page (#209)`

### Task 4: Demo, e2e, screenshots

**Files:**
- Modify: `src/server/demo/pieces.ts` (new piece `choreBidding`: "Vynést koš" proposed by Táta at 10 with no bids, and "Zalít kytky" proposed by Táta at 4 with Starší's bid 6 and Mladší's bid 7, through `createTemplateIn` and `bidOnTemplateIn` with the switch on), `src/server/demo/seeds.ts` (add to `demo`; new seed `chores`: pieces `[choreBidding]`, features `['recurring', 'choreBidding']`), `src/server/demo/seed.test.ts`
- Create: `e2e/chore-bidding.spec.ts`; Modify: `e2e/suites.ts` (row `chores`), `e2e/recurring.spec.ts`
- [ ] **Step 1: e2e** `chore-bidding.spec.ts`: (1) Mladší opens Vynést koš from Domů (Jiná cena), bids 11 → toast Nabídka odeslána, his Domů row shows Otevřít; Táta opens it from Domů Vyjednávání, taps Přijmout 11 (Mladší) → chip Platí, score 11, no Přijmout / Odmítnout nabídky / Souhlasím left. (2) On Zalít kytky: Starší taps Nechci → toast Nabídka stažena; Táta taps Odmítnout nabídky → toast Nabídky odmítnuty, the thread shows both bids uzavřeno. Switch off: `e2e/recurring.spec.ts` (seed `recurring`: recurring on, choreBidding off; its `templates` piece has a proposed chore by Táta) gets `a proposed chore offers no bidding with choreBidding off`: Táta's Úkoly row has no link, Starší's `/sablona/<id>` is not found (Review Focus 4).
- [ ] **Step 2:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm exec playwright test e2e/chore-bidding.spec.ts e2e/recurring.spec.ts --trace off` → PASS.
- [ ] **Step 3:** screenshots, light, one file per state, each at 393×852 @3x and at 360×800, with a long chore name (about 30 letters, e.g. "Vynést koš a vytřít předsíň u dveří" in a screenshot-only DB): brother page with his bid, after Nechci, with no bid; parent page with one bidder, at a tie, with no bids; brother's and parent's Domů rows; parent's Úkoly proposed row. For the UX judge and the brief.
- [ ] **Step 4: Commit** `feat(demo): proposed chores with bids, e2e (#209)`
