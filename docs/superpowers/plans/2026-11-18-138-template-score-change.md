# Template score change: server (PR A of #138) Implementation Plan

> **For agentic workers:** execute with superpowers:executing-plans (CLAUDE.md PR flow step 3). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** after a template is agreed, takers bid and givers counter or accept, exactly as the domain in `src/domain/scoreChange.ts` allows; the template's score changes only on an acceptance; every step is stored and audit-logged.

**Architecture:** one new append-only table `template_thread` (giver offers + taker bids, mirroring `task_thread` from PR #136), a small row module `src/server/templates/thread.ts`, the four actions in `src/server/templates/scoreChange.ts` (load → domain → write rows + audit in one transaction), reads for screens, and four server functions. Screens (TApprove price change, template detail) are **PR B**, stacked on this one, with its own plan.

**Tech Stack:** TanStack Start server functions, Drizzle + SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.1, §5.2 (bidding details), §5.10. Issue [#138 Template score change](https://github.com/SlatinskyJ/taskmaster/issues/138).

## Global Constraints

- §5.1: "A template score change runs the same way as bidding on a one-time task (5.2 path 2)… Each party has at most one open bid in the change; bidding again replaces it. Every bid is kept in the history. When the giver side accepts, it accepts the lowest open bid. The template gets that score; nobody is reserved anything."
- §5.1: "the old score stays in force until the change is agreed"; "A score change applies only to instances created after the change is agreed." Instances do not exist yet (#38), so: `templates.score` changes only inside an acceptance.
- §5.1: one change in flight per template; changes to different templates run in parallel.
- §5.10: every bid, counter and acceptance writes an audit entry in the same transaction (`writeAudit`). Rows are never deleted or edited except closing (`closed_at`, `closed_as`).
- Domain rules stay in `src/domain`; the server never re-decides them. Approvals and bids count **live** (only while the author is an active taker / giver).
- English identifiers; no Czech text in this PR (no screens).
- Never edit a committed migration; new migration via `pnpm db:generate --name template_thread`.

## Rulings (go into the PR brief)

1. **Counter at exactly an open bid accepts it.** §5.2 (Jakub 2026-11-18): "A giver's counter at exactly a taker's open bid accepts that bid." §5.1 says a template change runs the same way, so `counterTemplateScore` returns the agreed template at that score (all open bids at that score are accepted). Asked Jakub to confirm in the thread; if he says no, drop Task 1 and the `counter` branch of Task 4.
2. **No people-change hook.** The issue lists one (`resolveTemplate`), but every read and action already goes through `liveTemplateBook`, so a bid of someone who stopped being a taker is ignored everywhere and is closed as `closed` at the next acceptance. Jakub's rule (2026-11-17): don't design for users becoming inactive. Saves a hook, a system audit action and their tests.
3. **Giver-side offer of a giver who left stays in force**, like a one-time task's offer (the domain does the same).

## Review Focus

1. Two people act on stale screens (a bid moves between a giver seeing "lowest 5" and pressing accept) → `offer_changed`, nothing written. Test in Task 4.
2. A tie at the lowest bid → both bids close `accepted`, template gets that score once, one audit entry. Test in Task 4.
3. Accepting closes **every** open row of the change (other bids, the offer) as `closed`, so the next change starts empty. Test in Task 4.
4. A bid on a `proposed` template, or by a giver/admin → refused, no row, no audit. Test in Task 4.
5. A deactivated taker's open bid is not the lowest bid and is not shown. Test in Tasks 4 and 5.

---

### Task 1: Domain: counter at an open bid accepts it

**Files:**
- Modify: `src/domain/scoreChange.ts` (`counterTemplateScore`)
- Test: `src/domain/scoreChange.test.ts`

**Interfaces:**
- Produces: `counterTemplateScore(template, people, giverId, score)` unchanged signature; returns `{ status: 'agreed', score, change: null }` when `score` equals any live open bid.

- [ ] **Step 1: failing tests** in the "template score change runs like bidding" describe:
  - `it('a giver countering at exactly an open bid accepts it')`: `tbid(dishwasher(), OLDER, 4)` then `counterTemplateScore(t, family, DAD, 4)` → `{ status: 'agreed', score: 4, change: null }`.
  - same at a non-lowest bid: bids OLDER 4, YOUNGER 6; counter 6 → agreed at 6.
  - a deactivated taker's bid at that number does not count: counter at it → change with `offer.score` = that number.
- [ ] **Step 2:** `pnpm test src/domain/scoreChange.test.ts` → the three new tests FAIL.
- [ ] **Step 3:** after the `same_score` check, if any bid in the live book (`liveTemplateBook`) has `score`, return → `ok({ status: 'agreed', score, change: null })`. Update the header comment.
- [ ] **Step 4:** test passes; whole file green.
- [ ] **Step 5:** commit `Template counter at an open bid accepts it`.

### Task 2: Storage: `template_thread`

**Files:**
- Modify: `src/server/db/schema/templates.ts` (add table), `src/server/audit/actions.ts`
- Create: `drizzle/0010_template_thread.sql` + snapshot (generated)
- Test: `src/server/db/templates-schema.test.ts`

**Interfaces:**
- Produces: `templateThread` table, `TemplateThreadRow`, `TEMPLATE_THREAD_SIDES = ['giver','taker']`, `TEMPLATE_THREAD_CLOSINGS = ['replaced','accepted','closed']`. Columns: `id` pk autoincrement, `template_id` → templates, `user_id` → users, `side`, `score`, `created_at`, `closed_at` (null = open), `closed_as`. Checks as `task_thread` (side, score ≥ 1, closed pair). Unique partial indexes: one open giver row per template; one open taker row per (template, user). Index on `template_id`.
- Audit actions added: `template.bid_placed`, `template.score_countered`. Acceptance uses the existing `template.score_changed`.

- [ ] **Step 1: failing schema tests:** a second open giver row for one template throws (UNIQUE); a second open bid by one taker throws; a closed row plus a new open one is fine; `closed_as` without `closed_at` throws (CHECK); score 0 throws.
- [ ] **Step 2:** run → FAIL (no table).
- [ ] **Step 3:** add the table; `pnpm db:generate --name template_thread`; `pnpm db:check` passes. Add the two audit actions.
- [ ] **Step 4:** tests pass.
- [ ] **Step 5:** commit `Template thread table`.

### Task 3: Thread rows and the domain view

**Files:**
- Create: `src/server/templates/thread.ts`
- Modify: `src/server/templates/templates.ts` (`agreementOf` loads the change)
- Test: `src/server/templates/thread.test.ts`

**Interfaces:**
- Produces (in `thread.ts`):
  - `addEntry(tx, { templateId, userId, side, score }, now): { entry: TemplateThreadRow; replaced: TemplateThreadRow | null }`: closes the same side's open row (giver: the template's open offer; taker: his open bid) as `replaced`, inserts the new one.
  - `openRows(db, templateId): TemplateThreadRow[]` oldest first.
  - `closeThread(tx, templateId, acceptedIds: readonly number[], now): { accepted: number[]; closed: number[] }`: closes all open rows.
  - `threadOf(db, templateId): TemplateThreadRow[]` all rows oldest first.
- `agreementOf(db, row)` for `active`: `change` = `null` when no open rows, else `{ offer: open giver row ? { score, proposedBy: userId } : null, bids: open taker rows → { by, score } }`. Export `agreementOf` for Task 4.

- [ ] **Step 1: failing tests:** `addEntry` replacing a bid closes the old one `replaced` and returns it; giver offers replace each other but not bids; `closeThread` marks given ids `accepted`, the rest `closed`, leaves `openRows` empty; `agreementOf` on an active template with one offer and two bids returns that change, with none returns `change: null`.
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5:** commit `Template thread rows`.

### Task 4: The four actions

**Files:**
- Create: `src/server/templates/scoreChange.ts`
- Modify: `src/server/templates/index.ts` (export)
- Test: `src/server/templates/scoreChange.test.ts` (reuse the `family()` helper pattern from `templates.test.ts`; move it to `src/server/templates/testing.ts` and import it in both)

**Interfaces:**
- Consumes: domain `bidTemplateScore`, `counterTemplateScore`, `acceptLowestTemplateBid`, `acceptTemplateOffer`, `lowestBid`-equivalent via `liveTemplateBook`; Task 3.
- Produces, each `(db: Db | Tx, userId: number, templateId: number, score: number, now = new Date()): Result<TemplateRow, TemplateError>`, one transaction each, `not_found` for a missing template:
  - `bidOnTemplate`: domain bid; `addEntry` taker; audit `template.bid_placed`, `before` = replaced `{ entryId, score }` or none, `after` = `{ entryId, score }`.
  - `counterOnTemplate`: domain counter; if it returns a change → `addEntry` giver, audit `template.score_countered` (`before` = old offer `{entryId, score}` or none). If it returns agreed (Task 1) → `addEntry` giver, then accept with the live bids at `score` plus that offer row, `by: 'counter'`.
  - `acceptLowestBidOnTemplate`: domain accept (`score` = lowest the giver saw); accept the live open bids at that score, `by: 'bid'`.
  - `acceptOfferOnTemplate`: domain accept (`score` = offer the taker saw); accept the open offer row, `by: 'offer'`.
  - Shared `changeScore(tx, row, newScore, acceptedIds, by, actor, now)`: update `templates.score` + `updatedAt` (only where `status = 'active'`), `closeThread`, audit `template.score_changed` with `before: { score: old }`, `after: { score, entryIds: accepted, closedIds: closed, by }`.

- [ ] **Step 1: failing tests** (names are the assertions):
  - `a taker's bid is stored, the score stays` (score 3 still; one open taker row; audit `template.bid_placed`).
  - `a re-bid replaces his open bid and logs both numbers` (old row `replaced`; audit before/after).
  - `a giver counters; a taker accepts the offer → score changes, every open row closes` (offer row `accepted`, bids `closed`, audit `template.score_changed` with `by: 'offer'`, template score new).
  - `a giver accepts the lowest bid` (single lowest → that row accepted, `by: 'bid'`).
  - `a tie at the lowest bid accepts both bids, one score change`.
  - `a giver countering at a bid accepts it` (`by: 'counter'`, offer row + bid row accepted).
  - `stale numbers are refused and write nothing` (accept lowest with a number that moved → `offer_changed`; accept offer after a new counter → `offer_changed`; audit count unchanged).
  - `refusals write nothing`: bid on a proposed template → `not_agreed`; giver bids → `not_a_taker`; taker counters → `not_a_giver`; admin → refused; bid at current score → `same_score`; unknown id → `not_found`.
  - `a deactivated taker's bid is ignored`: OLDER bids 2, YOUNGER bids 4, OLDER deactivated (`updateUser`) → accept lowest at 2 → `offer_changed`, at 4 → ok; OLDER's row ends `closed`.
  - `the next change starts empty after an acceptance` (new bid → `agreementOf` shows only it).
  - `a failed audit write rolls back` each action: with `failAuditOn(db, action)` (trigger pattern from `src/server/tasks/lifecycle.test.ts:74`, moved to `testing.ts`) for `template.bid_placed`, `template.score_countered` and `template.score_changed`, the call throws and the thread rows and `templates.score` are as before.
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5:** commit `Template score change actions`.

### Task 5: Reads and server functions

**Files:**
- Modify: `src/server/templates/templates.ts` (`TemplateView` gains `change`), `src/server/templates/functions.ts`, `src/server/templates/parse.ts` (reuse `parseApproval` → rename `parseScoreAction`), `tests/server-fn-guards.test.ts`
- Test: `src/server/templates/templates.test.ts`, `src/server/templates/functions.test.ts`

**Interfaces:**
- `TemplateView.change: { offer: { score: number; byName: string } | null; bids: { takerId: number; name: string; score: number }[]; lowest: number | null } | null`: live bids only, lowest first then oldest; `null` with nothing open.
- `templateHistory(db, templateId): { side: 'giver' | 'taker'; name: string; score: number; at: string; closedAs: 'replaced' | 'accepted' | 'closed' | null }[]` oldest first (PR B's detail screen).
- `listTemplatesFn` becomes `giver,taker` (takers see agreed templates and their changes in PR B); `listTemplates` for a taker returns only `active` templates. Proposed ones stay in "Čeká na tebe".
- New server fns: `bidTemplateScoreFn` (taker), `counterTemplateScoreFn` (giver), `acceptTemplateBidFn` (giver), `acceptTemplateOfferFn` (taker), `getTemplateHistoryFn` (giver,taker). All return `TemplateActionResult` except the read. Add each to `EXPECTED_ROLES`.

- [ ] **Step 1: failing tests:** `listTemplates` returns exactly the `TemplateView` keys (pinned with `Object.keys`, no user ids beyond `takerId`, no password or session fields); `listTemplates` shows the change with the deactivated taker's bid gone and `lowest` right; taker gets only active templates; `templateHistory` lists replaced and accepted rows with names; `functions.test.ts`: each new fn rejects the wrong role (pattern already in that file); guard test fails until `EXPECTED_ROLES` updated.
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5:** commit `Template score change reads and server functions`.

### Task 6: Demo data

**Files:** `src/server/demo/seed.ts`, `src/server/demo/seed.test.ts`

- [ ] **Step 1: failing test:** after seeding, "Vyndat myčku" is active at 3 with one open bid by `mladsi` at 5 and Táta's offer at 4.
- [ ] **Step 2–4:** red; in `seedTemplates` call `bidOnTemplate(tx, mladsi, …, 5, now)` and `counterOnTemplate(tx, tata, …, 4, now)`; green.
- [ ] **Step 5:** commit `Demo: a template score change in flight`.

### Task 7: Verify

- [ ] `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm db:check && pnpm build` all pass.

## Size

About 380 changed lines outside tests, migrations and generated files. PR B (screens) follows with its own plan.
