# Period and default-week proposals (server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#43 Proposals for next period and default week settings](https://github.com/SlatinskyJ/taskmaster/issues/43), server half. The screens (Týden "next week" card, GDefaults, approvals on Domů) follow in a stacked PR on top of this one.

**Goal:** Parties can propose a different cutoff/levels for the next period, and givers can propose new default-week settings; once period agreement is reached a per-period change applies when that period starts and a defaults change is stored at once. Hidden behind the new launch switch `periodProposals` (off in prod).

**Architecture:** The rules are already in `src/domain/periods.ts` (`proposePeriodSettings`, `proposeDefaults`, `approve*`, `rejectPeriodProposal`, `withdrawPeriodProposal`, `lapsePeriodSettings`, `periodsToStart`/`endPeriodEarly` taking an agreed proposal). This PR stores them (two proposal tables, two approval tables), wires the agreed per-period proposal and the lapse into the two places a period starts (`rollPeriods`, `endRunningPeriod`), applies an agreed defaults proposal through `writePeriodDefaults` (PR #186), and adds guarded server functions. Every write is one transaction with its audit entry.

**Tech Stack:** TypeScript strict, SQLite + Drizzle, TanStack Start server functions, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §3 (period agreement), §5.8 (periods, changing the defaults, [call] open defaults proposal), §5.10 (audit).

**Base:** branch `47-default-week-settings` (PR #186). Stacked.

**Size:** about 420 changed lines (the people-change hook adds ~30) without tests and migrations (schema ~70, store ~170, wiring ~40, server functions ~90, flag ~10).

## Global Constraints

- Period agreement = every active taker and at least one active giver approved; proposing counts as approving; the admin never counts (spec §3).
- A per-period change needs agreement **before** that period starts; once started, cutoff and levels are locked (spec §5.8).
- A new default applies only to periods that have not started; the running period never changes (spec §5.8).
- [call] A defaults proposal not agreed when the next period starts stays open (spec §5.8).
- Every state change writes its audit entry in the same transaction (CLAUDE.md).
- New features behind DB feature flags; previews/tests enable them; prod stays off (Jakub 2026-11-22).
- Code, identifiers, DB in English; no Czech strings in this PR (no screens).

## Rulings (where the spec is silent)

1. **Agreed defaults proposal is stored at the moment of agreement**, through `writePeriodDefaults` (so due periods roll first with the old values), actor = the person whose approval completed the agreement (or the proposer when proposing already agrees). Its status stays `agreed`.
2. **Agreed per-period proposal applies when the period after `afterPeriodId` starts**, in `rollPeriods` (cutoff) and `endRunningPeriod` (settlement). It applies only to the first period started (domain `periodsToStart` already does this).
3. **Lapse** runs in the same two places, right after a period starts: every `pending` per-period proposal whose `afterPeriodId` is no longer the running period becomes `lapsed`, audited `period.proposal_lapsed` (new action) with a system actor.
4. **Server switch check:** every proposal server function refuses with `feature_off` when `periodProposals` is off, not only the hidden screens. Reading included.
5. **Per-period cutoff upper bound (extends the `MAX_LENGTH_DAYS` [call]; goes in the brief so Jakub can overturn it):** the domain's `isValidPeriodSettings(settings, startsAt)` also refuses a cutoff later than `addPragueDays(startsAt, MAX_LENGTH_DAYS)`; `startsAt` there is the running period's cutoff (the planned start). Levels are capped at `LEVEL_MAX` in the server parser, as for the defaults.
6. **People changes:** a role change in the admin console can give a pending proposal period agreement with no new approval (a taker who had not approved becomes a giver). A people-change hook `resolvePendingProposals(tx, people, now)` in `PEOPLE_CHANGE_HOOKS` (`src/server/users/hooks.ts`) promotes every pending proposal of both kinds that now has agreement (a per-period one only while the period it follows is still running, the same `already_started` check as `approveProposal`; otherwise it stays pending and lapses at the roll), audits `*.proposal_agreed` with a system actor, and stores an agreed defaults proposal through `writePeriodDefaults` (system actor). Deactivation itself stays out of scope (Jakub 2026-11-17).
7. **Admin direct save** leaves pending defaults proposals as they are (domain `setDefaults` comment).

## Review Focus

1. A proposal agreed one second before the cutoff applies; one agreed one second after does not (it lapsed at the roll). Tested at the boundary.
2. Settlement ends the period early: the agreed proposal for the next period applies to the period the settlement starts, not the one after.
3. Roller down over two cutoffs: the agreed proposal applies to the first started period only; the second takes defaults.
4. Approving after the period started is refused (`already_started`), and the row stays `pending` until the roll lapses it.
5. A defaults proposal reaches agreement on the last taker's approval: the stored defaults change in that same transaction, a failed `settings.changed` write rolls the approval back too, and the running period is untouched.

---

### Task 1: Schema, migration and switch

**Files:**
- Create: `src/server/db/schema/proposals.ts`, export from `schema/index.ts`
- Create: `drizzle/0019_period_proposals.sql` (generated + seed row for the switch)
- Modify: `src/lib/features.ts` (`periodProposals` in `FEATURE_KEYS`, `NO_FEATURES`, `ALL_FEATURES`)
- Modify: `src/server/audit/actions.ts` (append `period.proposal_lapsed` after `period.proposal_agreed`)
- Test: `src/server/db/proposals-schema.test.ts`, `src/server/features/flags.test.ts`

**Interfaces:**
- Also: `period.created` audit `after` gains `proposalId` (null when defaults applied) — Task 3.
- Produces tables:
  - `period_proposals`: `id` PK, `after_period_id` FK periods not null, `cutoff_at` text, `lower_level`, `upper_level`, `proposed_by` FK users, `status` text CHECK in (pending, agreed, rejected, withdrawn, lapsed), `closed_by` FK users nullable, `created_at`, `closed_at` nullable. CHECK levels 1 ≤ lower ≤ upper. Partial unique index: one `pending` or `agreed` row per `after_period_id`.
  - `defaults_proposals`: same lifecycle columns plus `length_days`, `cutoff_weekday`, `cutoff_hour`, `cutoff_minute`, levels; same CHECKs as `period_defaults`; partial unique index: at most one `pending` row.
  - `period_proposal_approvals` / `defaults_proposal_approvals`: `proposal_id` FK, `user_id` FK, `approved_at`; PK (proposal_id, user_id).
- Switch row `('periodProposals', 0)` in the migration.

- [ ] **Step 1: Failing schema tests:** `'one open per-period proposal per period'` (second pending insert for the same `after_period_id` throws), `'a closed one does not block a new one'`, `'one pending defaults proposal'`, `'status outside the list is refused'`, `'approval twice by one user is refused'`, `'defaults proposal length 10 is refused'`. Flags test: `'periodProposals reads off after migrations'`.
- [ ] **Step 2:** run `pnpm vitest run src/server/db/proposals-schema.test.ts src/server/features` → FAIL (no table / no key).
- [ ] **Step 3:** write the schema, `pnpm db:generate --name period_proposals`, append the INSERT for the switch, add the key and audit action.
- [ ] **Step 4:** same command → PASS; `pnpm db:check` → OK.
- [ ] **Step 5:** commit "Proposal tables and the periodProposals switch".

### Task 2: Proposal store (`src/server/periods/proposals.ts`)

**Files:**
- Create: `src/server/periods/proposalRows.ts`: row ↔ domain mapping, `agreedProposalFor`, `lapseProposals`. Imports only schema, audit and domain (no `defaults.ts`), so `periods.ts` can import it without a cycle.
- Create: `src/server/periods/proposals.ts` (the write paths and `proposalsView`), export both from `src/server/periods/index.ts`
- Modify: `src/server/users/hooks.ts` (add `resolvePendingProposals`); header comments in `periods.ts` and `defaults.ts` that say "#43 adds…" now describe what is there
- Modify: `src/domain/periods.ts` (`isValidPeriodSettings` upper bound, ruling 5) + `src/domain/periods.test.ts`
- Test: `src/server/periods/proposals.test.ts`

**Interfaces:**
- Consumes: domain proposal functions; `writePeriodDefaults(tx, actor, defaults, now)`; `currentPeriod`, `latestPeriod`; `listPeople(tx)`; `writeAudit`.
- Produces:
  - `type ProposalKind = 'period' | 'defaults'`
  - `type ProposalError = PeriodError | 'not_found' | 'no_running_period'`
  - `proposePeriod(db, userId, settings: PeriodSettings, now): Result<{ id: number; status: PeriodProposalStatus }, ProposalError>`
  - `proposeDefaultsChange(db, giverId, defaults: PeriodDefaults, now): Result<{ id; status }, ProposalError>`
  - `approveProposal(db, userId, kind, id, now)`, `rejectProposal(db, userId, kind, id, now)`, `withdrawProposal(db, userId, kind, id, now)`: same result type
  - `agreedProposalFor(tx, periodId): (PeriodSettingsProposal & { id: number }) | null` (proposalRows.ts)
  - `lapseProposals(tx, now): void` (proposalRows.ts): only `pending` rows whose period is no longer running
  - `resolvePendingProposals(tx, people, now): void` (proposals.ts)
  - `proposalsView(db, now): ProposalsView` = `{ period: PeriodProposalView | null; defaults: DefaultsProposalView | null }`, where each view is `{ id, settings, proposedBy, approvedBy: number[], status, waitingFor: number[] }` (`waitingFor` = active takers who have not approved, plus every active giver when no giver has). `period` = the pending or agreed one for the running period; `defaults` = the pending one.
- Audit: `period.proposal_created|approved|agreed|rejected|withdrawn|lapsed` on entity `period_proposal`; `defaults.proposal_*` on `defaults_proposal`. `before`/`after` = `{ status, approvedBy }`; created has `after` with the settings. Agreement writes `*.proposal_agreed` after the approval entry.

- [ ] **Step 1: Failing tests** (family fixture with periods rolled at SAT):
  - `'Starší proposes 60/120 for next week; Mladší and Táta approve → agreed, audited created, approved×2, agreed'`
  - `'proposing alone is pending; the proposer counts as approving'`
  - `'a second proposal while one is pending is refused (proposal_pending)'`, `'…while one is agreed (already_agreed)'`
  - `'the admin cannot propose or approve (not_a_party)'`
  - `'only the proposer withdraws (not_proposer)'`; `'any party rejects; a rejected one cannot be approved (not_pending)'`
  - `'approve after the cutoff is refused (already_started)'` — exactly at `cutoffAt` refused, at `cutoffAt − 1 ms` accepted
  - `'a cutoff more than 364 days after the running cutoff is invalid_settings'` (boundary 364 accepted); the same boundary pair in `src/domain/periods.test.ts` for `isValidPeriodSettings`
  - `'approve after the cutoff: refused, the row stays pending, nothing audited'`
  - `'a taker cannot propose defaults (not_a_giver)'`
  - `'defaults agreed by the last taker are stored at once; the running period keeps its levels'`; its audit order is `defaults.proposal_approved`, `defaults.proposal_agreed`, `settings.changed`
  - `'a failed audit write rolls back the approval'` (`failAuditOn(db, 'period.proposal_approved')`) and `'…rolls back the stored defaults'` (`failAuditOn(db, 'settings.changed')` on the agreeing approval)
  - `'defaults agreed at creation (a family with no takers) are stored at once'` (`settings.changed` written by `proposeDefaultsChange`)
  - `'a taker who had not approved becomes a giver: the hook marks the proposal agreed'` (through `editPerson`), for both kinds; for defaults the stored defaults change and the audit has `defaults.proposal_agreed` then `settings.changed`, both with a system actor
  - `'a role change after the cutoff but before the roll leaves the per-period proposal pending; the roll lapses it and the new period takes the defaults'`
  - `'proposalsView: waitingFor lists who has not approved'` with two givers (`addGiver` Máma): Táta approved → no giver listed; shape pinned with `toEqual` (ids only, no names or secrets)
- [ ] **Step 2:** `pnpm vitest run src/server/periods/proposals.test.ts` → FAIL (module missing).
- [ ] **Step 3:** implement. Each function: one `db.transaction`, load rows → domain object (`toDomain`), call the domain function, write the changed status/approvals, audit. `already_started` for a proposal whose period has started.
- [ ] **Step 4:** same command → PASS.
- [ ] **Step 5:** commit "Store period and default-week proposals".

### Task 3: Agreed changes apply when a period starts; pending ones lapse

**Files:**
- Modify: `src/server/periods/periods.ts` (`rollPeriods`, `endRunningPeriod`)
- Test: `src/server/periods/proposals-apply.test.ts`

**Interfaces:**
- Consumes: `agreedProposalFor`, `lapseProposals` (Task 2). Signatures of `rollPeriods` and `endRunningPeriod` do not change.

- [ ] **Step 1: Failing tests:**
  - `'an agreed change applies to the period the roll starts'` (cutoff and levels from the proposal; `period.created` audit shows them)
  - `'agreed one ms before the cutoff applies; still pending at the cutoff lapses'` (status `lapsed`, audit `period.proposal_lapsed`, actor system)
  - `'settling early starts the next period with the agreed change'` (through `settlePeriod`)
  - `'two cutoffs missed: only the first started period takes the change'`
  - `'a pending defaults proposal stays pending across a roll'`
  - `'settling early lapses a pending per-period proposal'` (status `lapsed`, audited)
  - `'the applied agreed proposal stays agreed after the roll'`
  - `'period.created after has proposalId of the applied proposal, null otherwise'`
- [ ] **Step 2:** `pnpm vitest run src/server/periods/proposals-apply.test.ts` → FAIL.
- [ ] **Step 3:** in `rollPeriods` pass `agreedProposalFor(tx, latest.id)` instead of `null` and call `lapseProposals(tx, now)` after inserting; same in `endRunningPeriod` with `endPeriodEarly(…, agreedProposalFor(tx, periodId))`. `insertPeriod` takes the applied proposal's id for the audit `after.proposalId` (only the first started period gets it).
- [ ] **Step 4:** same command, then `pnpm vitest run src/server/periods src/server/settlement` → PASS.
- [ ] **Step 5:** commit "Agreed period changes apply at the start; pending ones lapse".

### Task 4: Server functions

**Files:**
- Create: `src/server/periods/proposalFunctions.ts`
- Modify: `tests/server-fn-guards.test.ts` (`EXPECTED_ROLES`)
- Test: `src/server/periods/proposalFunctions.test.ts`

**Interfaces:**
- Produces (all `requireRole('giver', 'taker')` except `proposeDefaultsFn`: `requireRole('giver')`):
  - `getProposalsFn` (GET) → `ProposalsView`, or `{ error: 'feature_off' }`
  - `proposePeriodFn` (POST) data `{ cutoffAt: string (ISO), levels: { lower, upper } }`
  - `proposeDefaultsFn` (POST) data = `parseDefaults` shape (reuse from `functions.ts`)
  - `approveProposalFn`, `rejectProposalFn`, `withdrawProposalFn` (POST) data `{ kind: 'period' | 'defaults', id: number }`
  - results `{ ok: true; status } | { ok: false; error: ProposalError | 'feature_off' }`
- Parsers exported for tests: `parsePeriodProposal` (levels safe integers ≤ `LEVEL_MAX`), `parseProposalRef` (exact keys, safe integers, ISO date that round-trips, `kind` in the list).

- [ ] **Step 1: Failing tests:** parsers refuse levels above `LEVEL_MAX` (999 accepted, 1000 refused), extra keys, wrong kind, non-ISO date, fractions; `'switch off → feature_off and nothing written'` for each handler body (call the exported `…Handler(db, user, data, now)` functions the fns wrap); results pinned with `toEqual`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement thin wrappers: `getFlags(db).periodProposals` check, then the Task 2 function. Add all six to `EXPECTED_ROLES`.
- [ ] **Step 4:** `pnpm vitest run src/server/periods tests/server-fn-guards.test.ts` → PASS.
- [ ] **Step 5:** commit "Server functions for proposals behind periodProposals".

### Task 5: Switch on in previews, e2e and test seeds

**Files:**
- Modify: wherever the preview seed turns switches on (Track A's "Previews start with every switch on", if merged; else `src/server/demo/` flag seed) and the e2e server env — `ALL_FEATURES` already covers them once the key is added; verify.
- Test: existing preview-seed flag test gains `periodProposals: true`.

- [ ] **Step 1:** grep for `ALL_FEATURES` users; add a test expectation that the preview seed has `periodProposals` on.
- [ ] **Step 2:** run → FAIL if the seed lists keys by hand; PASS if it spreads `ALL_FEATURES` (then the step is just the assertion).
- [ ] **Step 3:** fix the seed if needed.
- [ ] **Step 4:** `pnpm test` → all pass; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** commit "Previews start with periodProposals on".
