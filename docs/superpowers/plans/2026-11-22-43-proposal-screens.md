# Proposal screens (Příští týden, Výchozí týden) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#43 Proposals for next period and default week settings](https://github.com/SlatinskyJ/taskmaster/issues/43), screen half. The server half is on `main` (PR #191).

**Goal:** Family members see, propose, approve and reject a different next week, and givers propose a new default week. Everything sits behind the `periodProposals` launch switch.

**Architecture:**
- One new screen, `/tyden/pristi`, for takers and givers. It is the UI doc's "Period" artboard: this week (locked), the proposal for next week with who agreed, the pending default-week proposal, and a form to propose.
- One giver-only screen, `/tyden/vychozi`, is the GDefaults artboard. It reuses the Správa `DefaultWeekView` form with a "Navrhnout všem" button.
- Entry points: a card on Týden, a row in "Čeká na tebe" on Domů, and a link in meeting step 3.
- The server view gains the context the screens need: the running week, the current defaults and the parties' names.

**Tech Stack:** TanStack Start routes and server functions, React, Tailwind (Hřiště tokens), Vitest + Testing Library, Playwright.

**Spec:**
- `docs/superpowers/specs/2026-11-16-taskmaster-design.md`: §3 (period agreement), §5.8, §5.9 step 3, §7 ("Period settings").
- UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md`: §5 (no typing for numbers), §7.2 (Period, GDefaults), §7.3 (M3Plan "Jiné hranice").

**Size:** about 550 changed lines without tests, e2e and generated files. This is one PR because the screens share one loader, one view helper module and one strings block. Splitting it would ship a Týden card that links to nothing.

## Global Constraints

- Czech UI text lives only in `src/lib/strings.ts`, in a new block `cs.proposals`.
- No typing for numbers (UI doc §5). Steppers for length and levels, a `type="time"` input for the end time, the same as Správa.
- Every tap target is at least 44 px (`min-h-tap`, `size-tap`).
- `periodProposals` off means no entry point anywhere, and both new routes redirect to `/tyden`. The server already answers `feature_off`.
- Dates are Prague wall clock through `src/domain/dates.ts` only.
- Every new route is added to `APP_PATHS` and `SCREEN_ROLES` in `src/lib/nav.ts`.

## Review Focus

1. A long Czech name (about 30 letters, e.g. "Bartoloměj Vyskočil-Nováček") in the "who agreed" list at 360 px: the name wraps, and the status stays whole on the right.
2. "Nesouhlasím" closes the proposal for everybody ([call]: one no ends it), so it asks first in a Dialog.
3. The per-week form at the extremes: length 1 and 364 days, levels 1 and `LEVEL_MAX`, upper never below lower. Steppers stop at each end.
4. No running week (before the first roll): `/tyden/pristi` shows an empty state, not a crash, and the form is hidden.
5. With the switch off, a typed URL `/tyden/pristi` redirects to `/tyden`, and Domů calls nothing.

---

### Task 1: Server view context

**Files:**
- Modify: `src/server/periods/proposals.ts` (`ProposalsView`, `proposalsView`)
- Test: `src/server/periods/proposals.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ProposalsView {
    period: ProposalView<{ cutoffAt: string; levels: Levels }> | null // as now
    defaults: ProposalView<PeriodDefaults> | null                    // as now
    /** The running week, or null before the first roll. */
    running: { startsAt: string; cutoffAt: string; levels: Levels } | null
    /** The stored default week (what next week gets without a change). */
    currentDefaults: PeriodDefaults
    /** Every active taker and giver, by id: who the screens name. No admin, no usernames. */
    parties: { id: number; name: string; role: 'taker' | 'giver' }[]
  }
  ```

- [ ] **Step 1: Failing tests.**
  - `proposalsView` pins `running` (ISO strings), `currentDefaults` equal to `getPeriodDefaults`, and `parties` = Táta, Starší, Mladší with no admin, using `toEqual` on the whole object so no extra field slips in.
  - Before the first roll, `running` is null.
- [ ] **Step 2:** Run `npx vitest run src/server/periods/proposals.test.ts`. Expected: FAIL (missing fields).
- [ ] **Step 3:** Implement. `parties` comes from `listPeople` (active takers and givers, `displayName`), sorted by id.
- [ ] **Step 4:** Run it again. Expected: PASS. Also run `npx vitest run src/server/periods` (function tests pin the handler shape).
- [ ] **Step 5:** Commit "Proposals view: the running week, the defaults and the parties".

### Task 2: View helpers (framework-free)

**Files:**
- Create: `src/components/proposals/proposalView.ts`
- Test: `src/components/proposals/proposalView.test.ts`

**Interfaces:**
- Consumes: `ProposalsView` (Task 1); `addPragueDays`, `fromPragueWallTime`, `toPragueWallTime` from `~/domain/dates`; `MAX_LENGTH_DAYS`; `LEVEL_MAX`.
- Produces:
  ```ts
  export interface NextWeekForm { lengthDays: number; hour: number; minute: number; levels: Levels }
  /** Next week's cutoff: the Prague date of `startsAt` plus `lengthDays`, at hour:minute. */
  export function nextWeekCutoff(startsAt: Date, f: NextWeekForm): Date
  /** The form's start values: the default length, the default cutoff time, the default levels. */
  export function initialNextWeek(defaults: PeriodDefaults): NextWeekForm
  export function stepDays(f: NextWeekForm, by: 1 | -1): NextWeekForm // 1 … MAX_LENGTH_DAYS
  export function setNextLower(f: NextWeekForm, n: number): NextWeekForm
  export function setNextUpper(f: NextWeekForm, n: number): NextWeekForm
  /** Whole Prague days between two instants (for "7 dní" on the proposal card). */
  export function lengthInDays(startsAt: Date, cutoffAt: Date): number
  export type MyTurn = 'approve' | 'withdraw' | 'none'
  /** approve: I'm in waitingFor; withdraw: I proposed it and it is pending; else none. */
  export function myTurn(p: ProposalView<unknown>, me: number): MyTurn
  /** Rows for "who agreed": every party, ✓ when approved, "čeká" when in waitingFor; a giver
   *  who need not approve (another giver already did) is left out. */
  export function agreementRows(p: ProposalView<unknown>, parties: ProposalsView['parties']): { id: number; name: string; agreed: boolean }[]
  /** Domů rows: the proposals waiting for `me`. */
  export function waitingProposals(v: ProposalsView, me: number): ('period' | 'defaults')[]
  ```
- [ ] **Step 1: Failing tests.**
  - `nextWeekCutoff`:
    - start Sun 29 Nov 23:59, length 7, at 23:59 → Sun 6 Dec 23:59 Prague;
    - across the DST change (start Sun 22 Mar 2026 23:59, length 7) → Sun 29 Mar 23:59 Prague;
    - length 1 → the next day.
  - `stepDays` stops at 1 and at 364.
  - `setNextLower(…, LEVEL_MAX + 5)` gives `LEVEL_MAX` and pushes upper up; `setNextUpper` below lower gives lower.
  - `myTurn`:
    - proposer pending → withdraw;
    - in waitingFor → approve;
    - agreed → none;
    - not involved → none.
  - `agreementRows`:
    - with two givers and Táta approved, Máma is not listed;
    - with no giver approved, both givers show "čeká".
  - `waitingProposals` lists `period` only when `me` is in its waitingFor, and the same for `defaults`.
- [ ] **Step 2:** Run `npx vitest run src/components/proposals`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit "Proposal view helpers".

### Task 3: Strings, nav and the Příští týden screen

**Files:**
- Modify: `src/lib/strings.ts` (block `cs.proposals`); `src/lib/nav.ts` (`/tyden/pristi` taker+giver, `/tyden/vychozi` giver); `src/lib/nav.test.ts`
- Create: `src/components/proposals/NextWeekScreen.tsx` (pure `NextWeekView` + stateful wrapper); `src/components/proposals/ProposalCard.tsx`; `src/components/proposals/NextWeekForm.tsx`; `src/routes/_app/tyden/pristi.tsx` (and move `tyden.tsx` to `tyden/index.tsx` if the router needs it for nesting; `routeTree.gen.ts` regenerates)
- Test: `src/components/proposals/nextWeek.test.tsx`; `src/components/proposals/pristiPage.test.tsx` (route component outside `src/routes`, per the project rule)

**Interfaces:**
- Consumes: Task 1 and Task 2; `getProposalsFn`, `proposePeriodFn`, `approveProposalFn`, `rejectProposalFn` and `withdrawProposalFn` from `~/server/periods/proposalFunctions`; `ScoreStepper`; `Dialog`; `toast`.
- Produces: `ProposalCard({ kind, proposal, parties, me, busy, onApprove, onReject, onWithdraw, old })`, reused by Task 4.

Screen content (UI doc Period artboard):
1. The "Tento týden" card: dates (`weekLabel`), the chip "Zamčeno", and levels.
2. Section "Návrh na příští týden": a `ProposalCard` showing:
   - next week's dates, length in days, and levels as old (struck through) → new;
   - the "who agreed" rows;
   - buttons for `myTurn`: Souhlasím (ok) and Nesouhlasím (asks first in a Dialog), or Stáhnout návrh (also asks first);
   - an agreed proposal shows a "Dohodnuto" chip and "Platí od <start>", with no buttons.
3. The note "Změna platí, jen když souhlasí všichni před začátkem týdne. Jinak zůstane <defaults>."
4. With no open next-week proposal: the button "Navrhnout jinak" opens `NextWeekForm` in place. It holds:
   - a length stepper;
   - an end time input;
   - two `ScoreStepper`s;
   - "Navrhnout všem" (busy label "Posílám…"), plus "Zrušit".
5. Section "Návrh výchozího týdne", when one is pending: a `ProposalCard` (kind `defaults`) with length, end weekday and time, and levels, old → new.
6. Giver only: the link "Výchozí týden (rodiče) ›" to `/tyden/vychozi`.

Errors: each refusal code maps to a Czech message through one `proposalErrorMessage(code)`, shown in a `role="alert"` line or a toast. A thrown error shows the generic "Nepovedlo se. Zkus to znovu."; the form keeps its values, so the same button is the retry. After success: `router.invalidate()`.

Route: `beforeLoad` runs `guardScreen` and, with `!context.features.periodProposals`, a redirect to `/tyden`. The loader calls `getProposalsFn()`.

- [ ] **Step 1: Failing tests** (`NextWeekView`, rendered with fixtures from the Task 2 tests).
  - No running week → the empty state "Týden ještě nezačal"; no form button.
  - A pending proposal where I'm waiting → Souhlasím and Nesouhlasím. Nesouhlasím opens a dialog, and its confirm calls `onReject` once.
  - I proposed → only Stáhnout návrh.
  - Agreed → the "Dohodnuto" chip and no buttons.
  - No proposal → "Navrhnout jinak" opens the form. Submitting calls `proposePeriodFn` with `cutoffAt = nextWeekCutoff(...)` as an ISO string and the levels.
  - A refusal `proposal_pending` shows its Czech text; a throw shows the generic text and keeps the values.
  - Taker → no "Výchozí týden" link; giver → the link.
  - A 30-letter name renders in the agreement rows (class `break-words` on the name).
  - Busy: while a call runs, every button of the card is disabled and the pressed one shows its busy label.
- [ ] **Step 2: Failing test** in `nav.test.ts`: `/tyden/pristi` for taker and giver, not admin; `/tyden/vychozi` for giver only.
- [ ] **Step 3: Failing route test** in `pristiPage.test.tsx`: the switch off → the redirect to `/tyden`; on → the loader calls `getProposalsFn` once.
- [ ] **Step 4:** Run `npx vitest run src/components/proposals src/lib/nav.test.ts`. Expected: FAIL.
- [ ] **Step 5:** Implement the strings, nav, components and route; run `pnpm dev` once so `routeTree.gen.ts` regenerates.
- [ ] **Step 6:** Run the same command again, then `pnpm typecheck`. Expected: PASS.
- [ ] **Step 7:** Commit "Příští týden: next week's proposal, who agreed, propose".

### Task 4: Výchozí týden for givers

**Files:**
- Modify: `src/components/admin/DefaultWeekCard.tsx`. `DefaultWeekView` gets optional `saveLabel`, `busyLabel` and `hint` props; their defaults keep Správa unchanged (its tests stay green as they are).
- Create: `src/components/proposals/DefaultsProposalScreen.tsx`; `src/routes/_app/tyden/vychozi.tsx`
- Test: `src/components/proposals/defaultsProposal.test.tsx`

**Interfaces:**
- Consumes: `DefaultWeekView`; `ProposalCard` (Task 3); `proposeDefaultsFn`.

Screen:
- With a pending default-week proposal: its `ProposalCard`. There is no form, because the server allows only one pending proposal (`proposal_pending`).
- Otherwise: `DefaultWeekView` with `saved = currentDefaults`, `saveLabel` "Navrhnout všem", `busyLabel` "Posílám…", and the hint "Pošle se jako návrh. Začne platit, až souhlasí všichni kluci a jeden rodič. Běžící týden se nemění."
- Success → a toast "Návrh odeslán", and the card replaces the form.

The route: `guardScreen(role, '/tyden/vychozi')` (giver only) plus the switch redirect.

- [ ] **Step 1: Failing tests.**
  - Unchanged form → the button is disabled.
  - A change, then the button → `proposeDefaultsFn` is called with the form's values.
  - `proposal_pending` → its Czech text.
  - A pending proposal → the card, and no form.
  - A Správa test still finds "Uložit" (the default label).
- [ ] **Step 2:** Run `npx vitest run src/components/proposals src/components/admin`. Expected: FAIL (new tests only).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit "Výchozí týden: givers propose a new default week".

### Task 5: Entry points

**Files:**
- Modify:
  - `src/components/week/WeekScreen.tsx`: a `nextWeek` prop. When set, a card at the top of "Tento týden" reads "Příští týden" and links to `/tyden/pristi`, with the chip "Návrh čeká" when a proposal is pending.
  - `src/routes/_app/tyden.tsx`: with the switch on, the loader also calls `getProposalsFn`.
  - `src/components/tasks/WaitingForYou.tsx`: a `proposals` prop of kind `'period' | 'defaults'`, from `waitingProposals`. Each item is a row "Návrh na příští týden" or "Návrh výchozího týdne" with a link "Otevřít" to `/tyden/pristi`. It counts in the section total.
  - `src/routes/_app/index.tsx`: with the switch on, the loader calls `getProposalsFn` and passes the rows; the giver's idle check counts them.
  - `src/components/meeting/MeetingScreen.tsx` step 3: with the switch on, a ghost link "Jiné hranice" to `/tyden/pristi` (M3Plan, spec §5.9 step 3).
- Test:
  - `src/components/week/week.test.tsx`: the card shows only with `nextWeek`.
  - `src/components/tasks/` WaitingForYou tests: proposal rows and the count.
  - `meeting.test.tsx`: the link shows only with the switch on.

- [ ] **Step 1:** Failing tests as listed.
- [ ] **Step 2:** Run `npx vitest run src/components/week src/components/tasks src/components/meeting`. Expected: FAIL.
- [ ] **Step 3:** Implement. The switch reaches components through the route context, as `features.recurring` does on Domů.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit "Entry points to proposals: Týden card, Domů row, meeting link".

### Task 6: Demo data and e2e

**Files:**
- Modify: `src/server/demo/pieces.ts` (new piece `proposals`); `src/server/demo/seeds.ts` (add `proposals` to `demo`; new seed `proposals` with pieces `[thisWeek, proposals]` and features `['week', 'periodProposals']`); `e2e/suites.ts` (row `{ name: 'proposals', spec: 'proposals.spec.ts', seed: 'proposals' }`)
- Create: `e2e/proposals.spec.ts`
- Test: `src/server/demo/*.test.ts` (the seed tests that list pieces)

The piece:
- Starší proposes next week with levels 60/120 and the default cutoff, and Táta approves, so Mladší is still waiting.
- Táta proposes a default week of 14 days with levels 60/120, still pending.

It uses the server functions' cores (`proposePeriod`, `approveProposal`, `proposeDefaultsChange`) through `step(...)`, as the other pieces do.

The e2e test:
- Mladší logs in. Domů shows "Návrh na příští týden" under Čeká na tebe. "Otevřít" leads to Příští týden; Souhlasím shows the "Dohodnuto" chip.
- Táta logs in and opens Týden, then Příští týden: the default-week proposal shows "čeká" for both brothers.

- [ ] **Step 1:** Write the e2e spec and the seed test change. Run `pnpm test` for the seed tests. Expected: FAIL.
- [ ] **Step 2:** Implement the piece and the seed.
- [ ] **Step 3:** Run `pnpm test`, then `pnpm build && npx playwright test e2e/proposals.spec.ts --trace off`. Expected: PASS.
- [ ] **Step 4:** Commit "Demo and e2e: a pending next-week and default-week proposal".

### Task 7: Screenshots and verification

- [ ] Run Playwright at 360×800, light theme, on the `demo` seed with the switch on. One file per screen and state, named `<screen>-<role>-<state>.png`:
  - Příští týden: pending/waiting (mladší), proposer (starší), agreed, form open, the Nesouhlasím dialog, and no running week (seed `family`).
  - Výchozí týden: the giver form and the pending card.
  - Týden with the card, Domů with the proposal row, and meeting step 3 with the link.
- [ ] Run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm db:check`. Expected: all pass.
