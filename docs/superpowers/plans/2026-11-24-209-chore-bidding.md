# Bidding on a proposed chore: server half (#209) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a recurring template is proposed, brothers bid on its first score and parents counter, accept the lowest, or turn the bids down, by the one-time bidding rules (spec §5.1 first bullet added in #225), behind a new switch `choreBidding`. Agreement makes the template active at the agreed score. Server half only; the screens are a stacked PR 2.

**Issue:** [#209 Bid on a proposed recurring chore](https://github.com/SlatinskyJ/taskmaster/issues/209). Stacked on #236 (stack 229: #225 → #228 → #234 → #236 → this).

**Architecture:** The domain wraps the one-time bidding functions (`src/domain/bidding.ts`, #208) instead of copying them: a proposed template is fed to them as a one-time Návrh, and any agreed result (`reserved` or `open`) comes back as an agreed template (no reservation). Bids and counters of a proposed template are rows in the existing `template_thread` table, the same table that later holds score changes of the active template; `templates.score` stays the current offer. Approvals follow the one-time task pattern: a new `templates.offer_round` counts offers, and `template_score_approvals` gets an `offer_round` column in its key, so a counter starts a fresh set of approvals by appending rows, never by overwriting one. The four existing template actions branch on the template's status; two new actions (Nechci, turn-down) cover proposed templates only (#232 extends them to `/sablona`).

**Tech Stack:** TypeScript, Drizzle/SQLite, Vitest, TanStack Start server functions.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.1 (first-score bidding bullet, #225), §5.2 path 2 (same number, a taker's no, a giver's turn-down), §3 (agreement).

**Size:** about 450 changed lines without tests and the migration (domain ~110, server actions ~220, views, parsers and functions ~120). One PR: the screens come separately.

## Global Constraints

- Spec §5.1: "while a template is proposed, takers may bid on its first score the same way as on a one-time task (5.2 path 2, including the same-number rule, a taker's no and a giver's turn-down), with **no reservation**. When the giver side accepts the lowest bid (a tie at the lowest is fine), counters at exactly an open bid, or a taker who bid says yes to the current offer, the template becomes active at that score. Instances never get bidding."
- Launch switch `choreBidding`, off in production (migration 0029 seeds the row with `enabled = 0`; the same migration adds `templates.offer_round` and the approvals' `offer_round`, existing rows 0). Switch off = today's behaviour exactly: every bidding action on a proposed template answers `not_agreed`, as now.
- Every state change writes its audit entry in the same transaction (`writeAudit`).
- Czech UI text only in `src/lib/strings.ts`; this PR adds no UI text.
- `src/domain/` stays framework-free.
- Ruling for the brief: once the template is active, its `/sablona` thread shows the first-price rows too (closed or accepted), as history; spec §5.1 "every bid is kept in the history".

## Review Focus

1. A counter changes `templates.score`; an approval of an earlier offer must not count, and the giver who gave it must be able to approve the new one (Máma approves 10, Táta counters 12, Máma taps Souhlasím at 12 → a new approval row, no key clash). Task 2 test "approvals count only in the current offer round", Task 3 test "a second giver approves after a counter".
2. Agreement by Souhlasím (path 1) while bids are open must close every open thread row, or the active template inherits the bids as a fake score change. Task 3 test "path-1 agreement closes the first-price bids".
3. People change (`resolveProposedTemplates`) activating a template with open bids: same duty. Task 3 test.
4. Switch off: a bid on a proposed template must answer `not_agreed` and write nothing (no thread row, no audit). Task 4 test.
5. Same-number rule across a turn-down: 5 → turn-down → 5 is allowed; 5 → Nechci → 5 is refused. Task 1 and Task 3 tests.

---

### Task 1: Domain — proposed template bidding

**Files:**
- Modify: `src/domain/agreement.ts` (type `TemplateAgreement` proposed variant; `proposeTemplate`, `resolveTemplate`, `approveTemplate`)
- Create: `src/domain/templateBidding.ts`
- Modify: `src/domain/index.ts` (export it)
- Test: `src/domain/templateBidding.test.ts`, `src/domain/agreement.test.ts`

**Interfaces:**
- Produces:
  - `TemplateAgreement` proposed variant becomes `{ status: 'proposed'; proposal: ScoreProposal; book: BidBook; lastBids: readonly OpenBid[] }`. `proposeTemplate` returns `book: EMPTY_BOOK, lastBids: []`. `resolveTemplate` prunes `book` with `liveBook` as `resolveOneTime` does.
  - In `templateBidding.ts`, each takes the template first and returns `Result<TemplateAgreement, AgreementError>`; each fails `not_proposed` on an agreed template:
    - `placeProposedTemplateBid(t, people, takerId, score)`
    - `withdrawProposedTemplateBid(t, people, takerId)`
    - `turnDownProposedTemplateBids(t, people, giverId, seen: readonly OpenBid[])`
    - `counterProposedTemplate(t, people, giverId, score)`: the bidders at `score` are read from the live book (a tie agrees too, so the set the giver saw does not change the outcome)
    - `acceptProposedTemplateOffer(t, people, takerId, score)`: a taker with an open bid
    - `acceptLowestProposedTemplateBid(t, people, giverId, score)`
- Approach: a private `asTask(t)` gives `{ status: 'proposed', offer: t.proposal, book, lastBids }`; a private `back(r)` maps a one-time result `reserved`/`open` to `{ status: 'agreed', score, change: null }` and `proposed` to the template variant. No rule is restated here.

- [ ] **Step 1: Write the failing tests** in `templateBidding.test.ts` (people: Táta giver 2, Starší taker 3, Mladší taker 4; a template proposed at 10 by Táta):
  - `a bid adds to the book; the offer and his last bid are refused` → bid 12 ok; bid 10 `same_score`; bid 12 again `same_score`
  - `Nechci closes only his bid and still blocks the same number` → Starší 12, Mladší 14, Starší withdraws: book = Mladší 14; Starší bids 12 → `same_score`
  - `a turn-down closes every bid and frees the number` → turn-down with seen [3:12] → proposed, book empty, proposal by Táta at 10; Starší bids 12 → ok
  - `a turn-down with other bids than seen is offer_changed`
  - `a counter is a new offer and resets the same-number rule` → counter 11: proposal {score 11, by 2, approvedBy [2]}, lastBids []
  - `a counter at an open bid agrees at it, a tie too` → Starší 12 and Mladší 12, counter 12 → `{ status: 'agreed', score: 12, change: null }`
  - `accept lowest agrees at the lowest; a moved lowest is offer_changed`
  - `a bidder's yes to the offer agrees at it; without a bid it is no_bid`
  - `every action on an agreed template is not_proposed`
  - `a brother cannot counter, accept lowest or turn down; a parent cannot bid or withdraw` → `not_a_giver` / `not_a_taker`
  - `an admin can do none of them`
  - `score boundaries: 1 is a valid bid, 0 and 1.5 are invalid_score`
- [ ] **Step 2:** `pnpm vitest run src/domain/templateBidding.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement the type change and `templateBidding.ts`. Update `agreement.test.ts` expectations for the new `proposeTemplate` shape.
- [ ] **Step 4:** `pnpm vitest run src/domain` → PASS; `pnpm typecheck` lists only the server callers Task 2 changes.
- [ ] **Step 5: Commit** `feat(domain): bidding on a proposed template (#209)`

### Task 2: Server — read a proposed template's bidding

**Files:**
- Modify: `src/server/templates/thread.ts` (add `lastBids`)
- Modify: `src/server/templates/templates.ts` (`agreementOf`, `approvers`, `approveIn`), `src/server/db/schema/templates.ts`
- Create: `drizzle/0029_chore_bidding.sql` via `pnpm db:generate --name chore_bidding`, then append the switch row `INSERT INTO feature_flags (key, enabled) VALUES ('choreBidding', 0);` in the same new file before committing it
- Test: `src/server/templates/templates.test.ts`, `src/server/templates/thread.test.ts`

**Interfaces:**
- Produces:
  - `lastBids(db, templateId): TemplateThreadRow[]`: each taker's newest taker row after the newest giver row, open or closed, oldest first (same rule as `src/server/tasks/thread.ts` `lastBids`).
  - `lastBids(db, templateId, since = 0)`: the floor is the newer of `since` and the newest giver row (as the task helper). This PR passes 0; #232 passes the agreement's last thread row so first-price bids never block a later change.
  - `agreementOf(db, row)` for a proposed row: `proposal = { score: row.score, proposedBy: <newest giver row's userId, else row.createdBy>, approvedBy: approvers(db, row.id, row.offerRound) }`, `book` = open taker rows, `lastBids` from `lastBids()`.
  - `approvers(db, templateId, offerRound)`: approvals of that round only.
  - Schema (`src/server/db/schema/templates.ts`): `templates.offerRound integer not null default 0`; `templateScoreApprovals.offerRound integer not null default 0`, primary key `(templateId, userId, offerRound)`. Doc comments on both tables rewritten (a proposed template's score now changes by counters; approvals are per offer round, append-only; `template_thread` also holds a proposed template's first-price bidding).
  - `approveIn(tx, row, userId, now)` in `templates.ts`: the one helper that writes an approval row at `row.offerRound` (used by create, Souhlasím, counter, turn-down).

- [ ] **Step 1: Write the failing tests:**
  - thread.test `lastBids counts from the newest giver row, closed bids included`
  - templates.test `agreementOf reads a proposed template's offer, bids and last bids from its thread`
  - templates.test `approvals count only in the current offer round` (Review Focus 1: rows in round 0 and 1, `offerRound` 1 → only the round-1 rows)
  - thread.test `lastBids with since ignores bids at or below it`
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(templates): read a proposed template's bidding (#209)`

### Task 3: Server — bidding actions on a proposed template

**Files:**
- Modify: `src/server/templates/scoreChange.ts`
- Modify: `src/server/templates/templates.ts` (`approveTemplateScoreIn`, `resolveProposedTemplates`: close the thread on agreement)
- Modify: `src/server/audit/actions.ts` (add `template.bid_withdrawn`, `template.bids_turned_down`), `src/server/audit/README.md`
- Create test: `src/server/templates/proposedBidding.test.ts`

**Interfaces:**
- Consumes: Task 1 functions, Task 2 `agreementOf`, `lastBids`.
- Produces:
  - The four existing actions (`bidOnTemplateIn`, `counterOnTemplateIn`, `acceptLowestBidOnTemplateIn`, `acceptOfferOnTemplateIn`) take an optional sixth argument `opts: { choreBidding: boolean } = { choreBidding: false }` (callers in `src/server/demo/pieces.ts` and existing tests keep working unchanged). On a proposed row: `!opts.choreBidding` → `fail('not_agreed')` before any write; else the Task 1 function. On an active row: unchanged.
  - New `withdrawTemplateBidIn(tx, takerId, templateId, now, opts)` and `turnDownTemplateBidsIn(tx, giverId, templateId, seen: {takerId, score}[], now, opts)`; on an active row both `fail('not_proposed')` (until #232). With `inTransaction` twins `withdrawTemplateBid`, `turnDownTemplateBids`.
  - Writes on a proposed template:

| Action | Thread rows | `templates` | Audit |
| --- | --- | --- | --- |
| bid | `addEntry` taker row (replaces his open bid) | — | `template.bid_placed` (existing shape) |
| Nechci | his open bid closes `closed` | — | `template.bid_withdrawn` before `{entryId, score}` |
| turn-down | every open bid closes `closed`; new giver row at `row.score` (replaces the open offer row, if any); his approval at the new round | `offerRound` + 1 | `template.bids_turned_down` before `{score, offerRound, entryIds, replacedOffer?: {entryId, score}}` after `{score, offerRound, entryId}` |
| counter, no agreement | new giver row (replaces); his approval at the new round | `score` = counter, `offerRound` + 1 | `template.score_countered` before `{score, offerRound, replacedOffer?: {entryId, score}}` after `{score, offerRound, entryId}` |
| any agreement | `closeThread`; accepted: the bids at the score, plus the offer row when the agreement is at the offer (a bidder's yes, a Souhlasím) or the counter row when a counter agreed it; the rest `closed` | `score`, `status 'active'`, `agreedAt` | `template.agreed` after `{status: 'active', score, by: 'bid' \| 'offer' \| 'counter' \| 'approval', entryIds, closedIds}` |

  - Approvals are only ever appended (`approveIn`, Task 2): nothing is overwritten, so the audit entries above plus `template.score_approved` (now with `offerRound`) are the whole history (§5.10).
  - `approveTemplateScoreIn` and `resolveProposedTemplates`: when the template becomes active, `closeThread(tx, id, <open offer row id, if any>, now)` and put `entryIds`/`closedIds` in the `template.agreed` entry (Review Focus 2, 3). Switch-independent: with the switch off there are no rows, so nothing changes.

- [ ] **Step 1: Write the failing tests** in `proposedBidding.test.ts` (demo people from `~/server/templates/testing`; a template proposed at 10 by Táta; `on = { choreBidding: true }`):
  - `switch off: each of the six actions answers not_agreed and writes nothing` (one `it.each` over bid, counter, accept lowest, accept offer, Nechci, turn-down: no thread row, no audit row, template unchanged; Review Focus 4)
  - `a bid writes a taker row and template.bid_placed; the template stays proposed at 10`
  - `Nechci closes only his bid: Mladší's stays open; his same number again is same_score` (Review Focus 5)
  - `a turn-down closes the bids, re-offers 10, and the same number is allowed again` (Review Focus 5)
  - `a counter moves the offer: score 12, offerRound 1, a giver row, his approval in round 1; the replaced offer row is in the audit entry; a brother's Souhlasím at 12 agrees and the counter row is accepted` (Review Focus 1 end to end)
  - `a second giver approves after a counter` (Máma's approval in round 0, Táta counters, Máma's Souhlasím at 12 → ok, a round-1 row, no throw; Review Focus 1)
  - `accept lowest: active at the lowest, bids at it accepted, the rest closed, template.agreed by bid`
  - `a tie at the lowest agrees too, both bids accepted`
  - `a counter at an open bid agrees at it, counter and bid rows accepted`
  - `a bidder's yes agrees at the offer`
  - `path-1 agreement closes the first-price bids` (Starší bids 12, Mladší says Souhlasím at 10 → active at 10, Starší's row `closed`, `agreementOf` has `change: null`; Review Focus 2)
  - `people change activating a proposed template closes its bids` (Review Focus 3)
  - `wrong actor: a giver bids → not_a_taker, a taker counters → not_a_giver, writes nothing`
  - `withdraw and turn-down on an active template are not_proposed`
  - `an audit failure rolls back the whole action` (each new write path: bid, withdraw, turn-down, counter, agreement; stub `writeAudit` to throw as existing tests in `scoreChange.test.ts` do)
  - `instances: a proposed template with bids makes none` (`canCreateInstances` unchanged; one test through `createInstance` on the proposed row → refused)
- [ ] **Step 2:** `pnpm vitest run src/server/templates` → FAIL.
- [ ] **Step 3:** Implement. Existing `scoreChange.test.ts` callers pass `{ choreBidding: false }` (active templates ignore it).
- [ ] **Step 4:** `pnpm vitest run src/server` → PASS.
- [ ] **Step 5: Commit** `feat(templates): bidding actions on a proposed template (#209)`

### Task 4: Switch, server functions, views, demo seed

**Files:**
- Modify: `src/lib/features.ts` (`choreBidding` key after `reopenBidding`, in `NO_FEATURES`/`ALL_FEATURES`), `src/server/features/README.md`
- Modify: `src/server/templates/functions.ts`, `src/server/templates/parse.ts`
- Modify: `src/server/templates/templates.ts` (`TemplateView.bidding`)
- Modify: `src/server/demo/seeds.ts` (`demo` turns `choreBidding` on; no new piece in this PR: PR 2 adds the sample chore with the screens). `src/server/demo/pieces.ts` keeps its calls (the `opts` default).
- Test: `src/server/templates/functions.test.ts`, `tests/server-fn-guards.test.ts`, `src/server/templates/templates.test.ts`, `src/lib/features.test.ts` (if it lists keys), `src/server/features/*.test.ts`

**Interfaces:**
- Produces:
  - Handlers (plain functions, tested directly, like `withdrawBidHandler` in `src/server/tasks/functions.ts`): `bidTemplateScoreHandler`, `counterTemplateScoreHandler`, `acceptTemplateBidHandler`, `acceptTemplateOfferHandler`, `withdrawTemplateBidHandler`, `turnDownTemplateBidsHandler`, each `(db, userId, data, now) → TemplateActionResult`, reading `getFlags(db).choreBidding` and passing it as `opts`. The four existing `…Fn` call them; new `withdrawTemplateBidFn` (role `taker`, `parseTemplateId`) and `turnDownTemplateBidsFn` (role `giver`, new `parseTemplateTurnDown`: `{ templateId, bids: { takerId, score }[] }`, 1 to 20 bids, one per taker (as `parseTurnDown` for tasks), else the parse error the other parsers throw). Every template score a person sends (`parseApproval` for approve, bid, counter and both accepts; each turn-down bid) is capped at `TASK_SCORE_MAX` (999, `src/lib/taskLimits.ts`) like the task parsers.
  - `TemplateView.bidding: TemplateChangeView & { lastBids: { takerId: number; score: number }[] } | null`: proposed templates only (null when agreed), offer = the current proposal `{ score, byName }`, live bids lowest first, `lowest`, `lastBids`. `change` stays agreed-only.

- [ ] **Step 1: Write the failing tests:**
  - guards test: `withdrawTemplateBidFn` → `taker`, `turnDownTemplateBidsFn` → `giver`
  - functions.test: `each handler with the switch off on a proposed template answers not_agreed`; `with it on, a bid answers ok with score 10`; `with it on, Nechci closes Starší's bid and a turn-down with the bids he saw (mapped from {takerId, score}) closes them` (both handlers end to end); `turn-down parse takes 20 bids, refuses 21, 0 bids, two bids of one taker, a 0 score, a missing templateId`; `parseApproval takes 999 and refuses 1000`
  - templates.test: `a proposed template's view has its bidding; an agreed one has bidding null` (pin the exact shape with `toEqual`: no user ids beyond `takerId`, no timestamps)
  - features test: the migration's row reads `choreBidding: false`; `demo` seed turns it on
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement; `pnpm db:check` passes.
- [ ] **Step 4:** `pnpm test`, `pnpm typecheck`, `pnpm lint` → PASS.
- [ ] **Step 5: Commit** `feat(templates): choreBidding switch and server functions (#209)`
