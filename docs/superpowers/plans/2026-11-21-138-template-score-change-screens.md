# Template score change: screens (PR B of #138) Implementation Plan

> **For agentic workers:** execute with superpowers:executing-plans (CLAUDE.md PR flow step 3). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the brothers and the parents can change an agreed recurring template's score on a phone: a template page with the price history, bid / counter / accept buttons, and the ways in from Domů and Úkoly.

**Architecture:** the server for this is merged ([#147 Template score change: server](https://github.com/SlatinskyJ/taskmaster/pull/147)). This PR adds one read (`getTemplateDetailFn`, replacing the unused `getTemplateHistoryFn`), a framework-free view module `src/components/templates/priceView.ts` (what buttons a person gets, what each sends), one call map, a `TemplatePricePanel`, the route `/sablona/$templateId`, and entry rows. It reuses the task bidding UI from [#145 Bidding on one-time tasks: screens](https://github.com/SlatinskyJ/taskmaster/pull/145): `BidThread`, `ScoreStepper`, `TaskRow`, `useTaskAction`.

**Tech Stack:** TanStack Start/Router, React, Tailwind v4 + shadcn (Hřiště), Vitest + `renderToStaticMarkup`.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.1, §5.2 (bidding details), §7; `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §6, §7 (TApprove "price change", GTask "change price"). Jakub 2026-11-18: only a giver's counter at exactly the lowest live bid accepts it; a higher counter is a plain offer. Closes [#138 Template score change](https://github.com/SlatinskyJ/taskmaster/issues/138).

## Global Constraints

- Czech UI text only in `src/lib/strings.ts`; code in English.
- §5.1: the old score stays until someone accepts; "A score change applies only to instances created after the change is agreed." The page says so in one line.
- §5.1: a brother bids (one open bid, a re-bid replaces it); the parents share one offer to every brother; a parent accepts the lowest bid; any brother accepts the offer. Nobody is reserved anything.
- A screen sends back exactly the number it showed; the server refuses a stale one (`offer_changed`), so the screen shows that error and reloads.
- UX: every tap target ≥ 44 px (`Button` sizes and `buttonVariants`, as #145); every request shows a busy state and on failure a Czech toast and the same button to try again (`useTaskAction`); no new animation; long Czech names wrap, never cut (360 px).
- Server functions keep their role guards; `tests/server-fn-guards.test.ts` pins them.

## Rulings (go into the PR brief)

1. **Where a brother starts a change:** a new section "Opakované úkoly" at the bottom of a brother's Domů lists agreed templates, each with "Jiná cena" to its page. TLog (Zapsat, #38) is still a placeholder; when #38 builds the template tiles, the link moves there. Without this a brother could only answer a parent's offer, never start a change (§5.1 "any party may propose").
2. **"Čeká na tebe"** gets a template row when a change waits for this person's side: a brother when a parent's offer is open (any brother may accept, so every brother sees it until it closes); a parent when live bids are open. Parents see it in "Čeká na tebe", not in "Vyjednávání" (that list is tasks only and stays so).
3. **Template page for a brother** only for agreed templates (a proposed one is approved from "Čeká na tebe", as today); `/sablona/<id>` of a proposed template → not found for a brother, the page without price buttons for a parent.
4. **The page replaces the unused `getTemplateHistoryFn`** with `getTemplateDetailFn` returning the template and its thread in the task thread's shape (`ThreadEntry`), so `BidThread` renders both. `templateHistory` is removed with its test (no caller on `main`).

## Review Focus

1. A brother at the page while Táta changes the offer → he taps "Přijmout 4", server says `offer_changed`, toast "Nabídka se mezitím změnila", page reloads with the new number. Test in Task 3 (`priceView` sends the shown number) and Task 2 (error message mapping).
2. A parent picks a number on the stepper equal to the lowest bid → the send button reads "Přijmout 5 (Mladší)" with the accept hint, not "Nabídnout". At a higher bid it stays "Nabídnout". Test in Task 3.
3. The stepper at the current score, the open offer, or the brother's own bid → send disabled (the server would answer `same_score`). Test in Task 3.
4. A 30-letter template name ("Vyluxovat celý obývák a chodbu") in every new row and the page title at 360 px wraps whole. Screenshots in Task 6.
5. Admin opens `/sablona/1` → the screen guard sends him away, like `/ukol/$taskId`. Test in Task 5 (`nav.test.ts`).

---

### Task 1: Server read for the page

**Files:**
- Modify: `src/server/templates/templates.ts` (replace `templateHistory` with `getTemplateDetail`), `src/server/templates/functions.ts`, `tests/server-fn-guards.test.ts`, `src/server/db/schema/templates.ts` (rewrap the long comment line, Architecture nit from #147)
- Test: `src/server/templates/templates.test.ts`

**Interfaces:**
- Produces: `getTemplateDetail(db, templateId: number, viewerId: number): TemplateDetail | null` with `TemplateDetail = { template: TemplateView; thread: ThreadEntry[] }` (`ThreadEntry` type imported from `~/server/tasks/tasks`, `state = closedAs ?? 'open'`). Null for an unknown id, and for a non-giver viewer when the template is proposed.
- `getTemplateDetailFn` (`giver,taker`, validator `parseTemplateId`) replaces `getTemplateHistoryFn`; `EXPECTED_ROLES` updated.
- `TemplateActionResult` success becomes `{ ok: true; id: number; score: number }` (the template's score after the action), so a screen can say "Domluveno" when the score changed.

- [ ] **Step 1: failing tests:** `getTemplateDetail` returns the view plus the thread (`[{ id, side: 'taker', by: { id: mladsi, name: 'Mladší' }, score: 7, at, state: 'replaced' }, …]`) oldest first; a taker gets `null` for a proposed template and the detail for an agreed one; unknown id → `null`. Replace the `templateHistory` test.
- [ ] **Step 2–4:** red, implement, green (`pnpm vitest run src/server/templates tests/server-fn-guards.test.ts`).
- [ ] **Step 5:** commit `Template detail read for the price page`.

### Task 2: Strings and error messages

**Files:** `src/lib/strings.ts`, `src/lib/taskErrors.ts`, `src/lib/taskErrors.test.ts`

**Interfaces:** `cs.templatePrice`:
- `title: 'Cena'`, `history: 'Historie ceny'`, `now: (n) => \`Platí ${n} b.\``, `futureOnly: 'Nová cena platí jen pro nově vzniklé úkoly.'`, `otherPrice: 'Jiná cena'`, `recurring: 'Opakované úkoly'`;
- `acceptOffer: (n) => \`Přijmout ${n}\``, `acceptOfferHint: 'Úkol bude stát tolik pro všechny.'`;
- `acceptBid: (n, names) => \`Přijmout ${n} (${names})\``, `acceptBidHint: 'Nová cena platí hned.'`;
- `bidLabel: 'Chci jinou cenu'`, `bidHint: 'Nabídka půjde rodičům.'`, `offerLabel: 'Nová nabídka'`, `offerHint: 'Nová nabídka pro oba.'`, `send: 'Nabídnout'`;
- `offerMeta: (name, n) => \`${name} nabízí ${n}\``, `bidsMeta: (names, n) => \`${names} chce ${n}\`` (several: `chtějí`, reuse `cs.bids.wantMany` wording).
- `taskErrorMessage`: `no_offer` → `cs.tasks.errors.offerChanged`; `not_agreed` → `cs.tasks.errors.gone`.

- [ ] **Step 1:** failing test in `taskErrors.test.ts`: `no_offer` and `not_agreed` give those messages (not `cs.login.failed`).
- [ ] **Step 2–4:** red, add the strings and the two cases, green.
- [ ] **Step 5:** commit `Czech text for the template price page`.

### Task 3: What the price page offers (`priceView.ts`)

**Files:**
- Create: `src/components/templates/priceView.ts`, `src/components/templates/priceCalls.ts`
- Test: `src/components/templates/priceView.test.ts`

**Interfaces:**
- `type PriceCall = { action: 'bid' | 'counter' | 'acceptBid' | 'acceptOffer'; data: { templateId: number; score: number } }`
- `priceButtons(t: TemplateView, me: Me): PriceButton[]` (`PriceButton = PriceCall & { key; label; hint; variant: 'ok' }`): a taker with an open offer → `[acceptOffer at offer.score]`; a giver with `change.lowest` → `[acceptBid at lowest, label with the names of every live bid at it]`; else `[]`; nothing for a proposed template or the admin.
- `priceSend(t, me, value): (PriceCall & { label; hint; disabled }) | null`: taker → `bid`, disabled when `value` is the score, the offer, or his own bid; giver → `counter`, label/hint of `acceptBid` when `value === change.lowest`, else `send`/`offerHint`; disabled when `value` is the score or the offer.
- `priceToast(shownScore, result): string`: `cs.bids.toast.agreed` when `result.score !== shownScore`, else `cs.bids.toast.sent`.
- `priceWaiting(t, me): boolean`: the "Čeká na tebe" rule of Ruling 2.
- `priceCalls.ts`: `callPrice(call)` → `bidTemplateScoreFn` / `counterTemplateScoreFn` / `acceptTemplateBidFn` / `acceptTemplateOfferFn`, the one place components reach them (as `bidCalls.ts`).
- `useTaskAction`'s `run` accepts `TemplateActionResult` too (widen its type parameter).

- [ ] **Step 1: failing tests** (demo numbers: score 3, Mladší bid 5, Táta offer 4):
  - Starší sees `[acceptOffer 4]`; Mladší sees `[acceptOffer 4]`; Táta sees `[acceptBid 5, 'Přijmout 5 (Mladší)']`; Máma the same; admin `[]`; proposed template `[]`.
  - Táta's send at 5 → `counter` with the acceptBid label; at 6 → `counter`, 'Nabídnout'; at 3 or 4 → disabled.
  - Mladší's send at 5 (his bid), 4 (offer), 3 (score) → disabled; at 6 → enabled `bid`.
  - Tie: Starší and Mladší both 5 → Táta's label `Přijmout 5 (Starší, Mladší)`.
  - `priceWaiting`: brother with an offer open → true; brother, no offer → false; parent with live bids → true; parent, only an offer → false.
  - `priceToast(3, { ok: true, id, score: 5 })` → 'Domluveno'; `priceToast(3, { …, score: 3 })` → 'Nabídka odeslána'.
  - `callPrice` sends each action to its function with `{ templateId, score }` (mock the four fns, as `bidCalls.test.ts`).
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5:** commit `Template price view and calls`.

### Task 4: Template page

**Files:**
- Create: `src/routes/_app/sablona/$templateId.tsx`, `src/components/templates/TemplatePricePanel.tsx`
- Modify: `src/lib/nav.ts` (`'/sablona/$templateId': ['taker', 'giver']`), `src/routeTree.gen.ts` (generated)
- Test: `src/components/templates/pricePanel.test.tsx`, `src/lib/nav.test.ts`

**Interfaces:**
- Route: loader parses the id with `parseTaskIdParam` (same rule), calls `getTemplateDetailFn`, `notFound()` on null. Page: `Screen title={t.title} back="/"`; a `Card` with the state chip (`negotiating` when a change is open, else the active chip), the score, `cs.templatePrice.now(score)`, `templateDetail(t)` and `futureOnly`; section "Historie ceny" with `BidThread` (empty → `EmptyState` "Zatím beze změny ceny."); `TemplatePricePanel key={score-threadLength}`.
- `TemplatePricePanel({ template, me })`: like `BidPanel`: yes buttons with hints, "Tvoje nabídka N" for a brother with a bid, the stepper (`ScoreStepper`, start at his bid or the offer or the score) and the send button on its own full-width line; busy state per button through `useTaskAction`; renders nothing for a proposed template.

- [ ] **Step 1: failing tests:** render with `renderToStaticMarkup` (as `bidPanel.test.tsx`): Táta sees 'Přijmout 5 (Mladší)' and the hint, 'Nová nabídka', a stepper; Starší sees 'Přijmout 4', 'Chci jinou cenu', no 'Tvoje nabídka'; Mladší sees 'Tvoje nabídka 5'; a proposed template renders `''`. `nav.test.ts`: admin may not see `/sablona/$templateId`, taker and giver may.
- [ ] **Step 2–4:** red, implement, `pnpm dev` regenerates `routeTree.gen.ts`, green.
- [ ] **Step 5:** commit `Template price page`.

### Task 5: Ways in

**Files:**
- Modify: `src/components/tasks/WaitingForYou.tsx` (price rows), `src/routes/_app/index.tsx` (loader adds `listTemplatesFn()`; taker section), `src/routes/_app/ukoly/index.tsx` (`TemplateRow` link)
- Create: `src/components/templates/RecurringList.tsx` (a brother's "Opakované úkoly")
- Test: `src/components/tasks/tasks.test.tsx`

**Interfaces:**
- `WaitingForYou` gains `priceChanges?: readonly TemplateView[]` (Domů passes `templates.filter((t) => priceWaiting(t, me))`); each row: `TaskRow name state="negotiating" points={score} meta={offer ? offerMeta : bidsMeta}` with a ghost link 'Otevřít' to `/sablona/$templateId`; counted in "Čeká na tebe (N)".
- `RecurringList({ items })`: section "Opakované úkoly", rows of agreed templates with `templateDetail` and a ghost link 'Jiná cena'; renders nothing when empty. Brothers only.
- Úkoly `TemplateRow`: an active template gets a ghost link to its page, 'Odpovědět' when `change?.bids.length`, else 'Cena'.

- [ ] **Step 1: failing tests:** `WaitingForYou` for Starší with the demo dishwasher shows 'Vyndat myčku', 'Táta nabízí 4', a link to `/sablona/<id>`, and the count includes it; for Táta shows 'Mladší chce 5'; `RecurringList` renders 'Opakované úkoly' and 'Jiná cena', and `''` for `[]`.
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5:** commit `Ways into the template price page`.

### Task 6: Verify, screenshots

- [ ] `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm db:check && pnpm build` all pass.
- [ ] Playwright at 360 px, light, demo data, with "Vyndat myčku" renamed in a scratch DB to "Vyluxovat celý obývák a chodbu": the page as Táta, Starší, Mladší; Domů "Čeká na tebe" as Starší and Táta; Starší's "Opakované úkoly"; Úkoly template rows; the empty history; a refused stale accept (toast). Named `<screen>-<role>-<state>.png`, outside the repo.
- [ ] Add the `preview` label.

## Size

About 400 changed lines outside tests and generated files (page ~80, panel ~80, priceView ~110, calls ~30, entry rows ~70, server ~30). Plus `routeTree.gen.ts`.
