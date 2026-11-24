# Chore first-price bidding: screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With switch `choreBidding` on, brothers and parents bid on a proposed recurring chore's first price from Domů and the chore's price page (/sablona), using the server half from PR #241.

**Architecture:** Server reads learn the switch: a brother may open a proposed chore's page, and a parent's "Vyjednávání" list takes a proposed chore with bids. `priceView.ts` (framework-free, unit-tested) decides the proposed chore's buttons from `TemplateView.bidding`; `TemplatePricePanel` renders them. Domů and Úkoly rows link to the page, mirroring a one-time Návrh. A demo piece and an e2e suite exercise it.

**Tech Stack:** TanStack Start, React, Vitest (static markup), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.1 (first-price bidding sentence, from PR #225) and §5.2 path 2; issue #209.

## Global Constraints

- Czech UI text only in `src/lib/strings.ts`; reuse `cs.bids.*` (Nabídnout, Chci jinou cenu, Nechci, Odmítnout nabídky, Odpovědět, Otevřít, Jiná cena) wherever the one-time Návrh uses them. New strings only where a chore differs.
- Switch off (production): every screen is exactly as today (no link on a proposed Úkoly row, Domů row only Souhlasím, a brother gets not found on a proposed chore's page). Pinned in `e2e/launch.spec.ts`.
- A screen sends back exactly the number it showed (offer, lowest bid, seen bids); the server refuses a stale one.
- Tap targets ≥ 44 px (`min-h-tap`), layout holds at 360 px.
- Score stepper has no text field, so no keyboard case is needed (CLAUDE.md forms rule applies to text fields).

## Review Focus

1. A brother with an open bid on a proposed chore: Domů row says Otevřít (not Souhlasím + Jiná cena), as for a Návrh. Task 3 test.
2. A brother's Nabídnout is disabled on the offer and on his last bid (`bidding.lastBids`), with `sameAgainHint`. Task 2 test.
3. A parent's turn-down sends exactly the bids he saw (`bidding.bids` mapped to `{takerId, score}`); a bid arriving meanwhile shows `turnDownChanged`. Task 2 + e2e.
4. Switch off: a brother opening `/sablona/<proposed id>` gets not found, and the parent's Úkoly proposed row has no link. Task 1 + launch e2e.
5. Agreement from the page (accept lowest) leaves the page showing the chore as Platí at the new score with no panel left over. e2e.

---

### Task 1: Server reads follow the switch

**Files:**
- Modify: `src/server/templates/templates.ts` (`getTemplateDetail`, `pendingTemplatePriceChanges`), `src/server/templates/functions.ts`
- Test: `src/server/templates/templates.test.ts`, `src/server/db/migrate.test.ts`

**Interfaces:**
- Produces:
  - `getTemplateDetail(db, templateId, viewerId, opts: BiddingOpts = { choreBidding: false })`: with the switch on, a taker may open a proposed template (today null). Admin unchanged.
  - `pendingTemplatePriceChanges(db, userId, opts = off)`: with the switch on, a giver's list also takes proposed templates with at least one live bid (`bidding.bids.length > 0`), oldest first, after the agreed ones. Taker list unchanged (he reaches a proposed chore through `pendingTemplateApprovals`).
  - `getTemplateDetailFn` and `listPendingTemplatePriceChangesFn` pass `{ choreBidding: getFlags(db).choreBidding }`.

- [ ] **Step 1: Failing tests:** templates.test `a brother opens a proposed chore's page only with choreBidding on`; `a parent's Vyjednávání takes a proposed chore with bids only with the switch on`; migrate.test `0029 keeps every template approval as offer round 1` (a template with two approvals written before 0029, read back after: both rows `offer_round` 1, template `offer_round` 1).
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
    - `priceButtons(t, me)`: brother → `Souhlasím` approve at `bidding.offer.score` (hint `cs.bids.approveHint` replaced by new `cs.templatePrice.firstAgreeHint` = "Úkol začne platit za {n} b."); parent with live bids → accept lowest (`acceptBid(lowest, names)` or `acceptTie(lowest)` on a tie), hint `cs.templatePrice.acceptHint`; a parent who has not approved this round (`approvedBy` lacks his name) and no bids → Souhlasím approve.
    - `priceRefusal(t, me): PriceButton | null`: brother with an open bid → Nechci (`withdraw`, hint `withdrawHint`); parent with live bids → Odmítnout nabídky (`turnDown` with exactly `bidding.bids` as `{takerId, score}`, hint `turnDownHint(offer)`); else null. Agreed templates → null.
    - `priceSend(t, me, value)`: brother → bid, disabled at the offer and at his `lastBids` score (hint then `sameAgainHint`); parent → counter, at exactly a live bid the label is the accept label (as today), disabled at the offer.
    - `myTemplateBid`, `stepperStart`, `priceMeta` read `bidding` for a proposed template the way they read `change` for an agreed one.
    - `priceToast`: `withdraw` → `toast.withdrawn`, `turnDown` → `toast.turnedDown`; approve or an accept that made the chore active → `toast.agreed`.
    - `templateChip`: proposed with live bids → `negotiating`; else as today.
- [ ] **Step 1: Failing tests** in priceView.test (a proposed `TemplateView` fixture at 10 by Táta; Starší bid 12): brother buttons (Souhlasím at 10, Nechci), brother send disabled at 10 and at his last bid 12 with `sameAgainHint`; Mladší (no bid) has no Nechci; parent buttons (Přijmout 12 (Starší), Odmítnout nabídky with bids `[{takerId: STARSI, score: 12}]`), tie label; second parent with no bids and no approval → Souhlasím; parent send at 12 = accept label; chip `negotiating` with bids, `proposed` without; `bidding: null` on a proposed template (switch off read) → no buttons, no send. priceCalls.test: the three new actions call their server functions with exactly `data`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(templates): what a proposed chore's price page offers (#209)`

### Task 3: Screens

**Files:**
- Modify: `src/components/templates/TemplatePricePanel.tsx` (render `priceRefusal` under the yes buttons, as BidPanel does for a Návrh), `src/routes/_app/sablona/$templateId.tsx` (proposed: header line `cs.templatePrice.proposedNow(score)` = "Návrh: {n} b."; no `futureOnly` line), `src/components/tasks/WaitingForYou.tsx` (template approval row with the switch on: Souhlasím + `Jiná cena` link; Otevřít link when he has a bid, same shape as `taskActions`), `src/components/templates/TemplateRow.tsx` (proposed row links to its page with the switch on: `Odpovědět` with bids, else `Otevřít`), callers pass `features.choreBidding`.
- Test: `src/components/templates/pricePanel.test.tsx`, `src/components/templates/templatePage.test.tsx`, `src/components/tasks/homePage.test.tsx`, `src/components/tasks/tasks.test.tsx`

- [ ] **Step 1: Failing tests:** pricePanel `a brother on a proposed chore sees Souhlasím, Nechci and the stepper`; `a parent sees Přijmout, Odmítnout nabídky`; templatePage `a proposed chore shows Návrh: 10 b. and no future-only line`; homePage `a brother's proposed chore row: Souhlasím + Jiná cena with the switch, Otevřít with his bid, only Souhlasím without the switch`; tasks.test `a parent's proposed Úkoly row links to its page only with the switch on`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(templates): bid on a proposed chore from Domů and its page (#209)`

### Task 4: Demo, e2e, screenshots

**Files:**
- Modify: `src/server/demo/pieces.ts` (new piece `choreBidding`: "Vynést koš" proposed by Táta at 10 with no bids, and "Zalít kytky" proposed by Táta at 4 with Starší's bid 6, through `createTemplateIn` and `bidOnTemplateIn` with the switch on), `src/server/demo/seeds.ts` (add to `demo`; new seed `chores`: pieces `[choreBidding]`, features `['recurring', 'choreBidding']`), `src/server/demo/seed.test.ts`
- Create: `e2e/chore-bidding.spec.ts`; Modify: `e2e/suites.ts` (row `chores`), `e2e/launch.spec.ts`
- [ ] **Step 1: e2e** `chore-bidding.spec.ts`: Mladší bids 11 on Vynést koš from Domů → page; Starší says Nechci; Táta opens it from Domů Vyjednávání, taps Přijmout 11 (Mladší) → chip Platí, score 11, no panel. Second test, on "Zalít kytky": Táta taps Odmítnout nabídky → toast Nabídky odmítnuty, bids closed in the thread. launch.spec: with the switch off, a parent's proposed Úkoly row has no link (Review Focus 4).
- [ ] **Step 2:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm exec playwright test e2e/chore-bidding.spec.ts e2e/launch.spec.ts --trace off` → PASS.
- [ ] **Step 3:** screenshots (iPhone 15 Pro 393×852 @3x, light) of the brother's and parent's page and the Domů rows, for the UX judge and the brief.
- [ ] **Step 4: Commit** `feat(demo): proposed chores with bids, e2e (#209)`
