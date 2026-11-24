# Settlement correction and manual point adjustment: screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#48 Settlement correction and manual point adjustment](https://github.com/SlatinskyJ/taskmaster/issues/48) (this PR closes it). Stacked on [#220 Settlement correction and manual point adjustment: server](https://github.com/SlatinskyJ/taskmaster/pull/220) (branch `48-corrections`).

**Goal:** The admin fixes a settled week or adds/takes points on Správa (directly, or with "Opravit" on a Sporné row), and the family sees corrections and adjustments on Týden and can dispute a manual adjustment.

**Architecture:** One fix bottom sheet (`FixDrawer`, vaul) with two modes, *week* (pick a level) and *points* (Přidat/Ubrat + number), on top of PR A's `correctSettlementFn` / `adjustPointsFn`. One new admin read (`getFixTargetsFn`) gives the sheet its takers and their recent settled weeks. Týden's read (`getWeek`) gains the adjustments and each settlement's latest correction; WeekScreen renders them. Everything stays behind the `disputes` switch.

**Tech Stack:** TanStack Start server functions, React, vaul Drawer, Tailwind v4, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.9 (corrections, adjustments), §5.11 (disputes: Correct), §6 (admin console); UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §7.5 ADisputes ("keep or correct"), AFix ("Settlement correction or point adjustment; reason required").

**Size:** about 700 changed lines outside tests, migrations and generated files (no migration). Over 400 because it is the one user-facing step of #48: the admin's form and the family's view must ship together, or a correction would change a boy's total with nothing on his screen explaining it. Under 800.

## Global Constraints

- UI text Czech, only in `src/lib/strings.ts`; code English.
- Behind the `disputes` switch: with it off, Správa shows no fix section and no Opravit, Týden shows no adjustment rows (adjustments cannot exist then anyway).
- Reason 1–1000 characters (`FIX_REASON_MAX`), points a whole number 1–9999 (`ADJUST_POINTS_MAX`), sign from Přidat/Ubrat.
- Dates through `src/domain/dates.ts` (`weekLabel` etc.).
- Tap targets ≥ 44 px (`min-h-tap`, `size-tap`); `motion-reduce:` on any transition added.
- The field being typed into stays visible with the phone keyboard open (CLAUDE.md "Forms on a phone"): bottom sheet, case in `e2e/keyboard.spec.ts`.
- Feature PR: demo piece in `demo`, own e2e suite row with its own seed.

## Rulings (open spec calls; go in the brief)

1. **Direct correction exists on Správa**, not only from a dispute (spec §5.9 "Only the admin can correct a settlement"; UI doc AFix is its own screen). The sheet lists each boy's last 8 settled weeks, newest first, with their *effective* level.
2. **Opravit on a settlement dispute opens week mode on that settlement**; on any other dispute it opens points mode with the item's boy preselected (a score dispute has no boy: the admin picks one). The admin cannot switch a settlement dispute to points mode (a settlement dispute is fixed by correcting it; server ruling: an adjustment fits any dispute, but the UI keeps it simple). Cost if wrong: one extra UI path later.
3. **No extra confirm dialog.** The send button names the whole action ("Ubrat 5 bodů – Starší", "Opravit na Horní – Starší") and the sheet shows the hint that the family reads the reason. A fix is never silent and can itself be corrected or offset, so it is not "cannot be undone" in the UX sense.
4. **The family sees adjustments where points are counted:** Týden → Tento týden lists adjustments made since this week started (the same window `pointsSince` counts); Historie lists, under each boy's week record, the adjustments made in that week, and the record's latest correction. Rozporovat only on a **manual** adjustment; one from a correction shows "Z opravy týdne …" and is disputed via its settlement (spec §5.11 locked items: "a settlement record, and a manual adjustment").
5. **A settlement record on Historie shows its effective level** (badge) and, when corrected, a line with the original and the reason. Its dispute value is the effective one (matches PR A's dispute value).

## Review Focus

1. A correction made while the boy's Týden is open elsewhere: the next load shows the new total and the row; stale Sporné row → `value_changed` closes the sheet and reloads (same as Ponechat).
2. `week_waiting` / `would_go_negative` refusals keep the sheet open with the typed reason and a Czech message.
3. A taker never sees another boy's adjustment rows or reasons on Týden (getWeek already filters takers; pin it for adjustments).
4. Long Czech reason (1000 chars) and long names at 360 px in the sheet, on Sporné and on Týden rows: wrap, never cut.
5. Adjustment exactly at the week start counts in Tento týden, not in history of the week before.

---

### Task 1: Server reads

**Files:**
- Modify: `src/server/disputes/list.ts` (AdminDisputeEntry gains `takerId: number | null`)
- Create: `src/server/corrections/targets.ts` (`getFixTargets`)
- Modify: `src/server/corrections/functions.ts`, `index.ts` (`fixTargetsHandler`, `getFixTargetsFn`, GET, admin only)
- Modify: `src/server/settlement/week.ts` (adjustments + corrections in `Week`)
- Test: `src/server/corrections/targets.test.ts`, `src/server/corrections/functions.test.ts`, `src/server/settlement/week.test.ts`, `src/server/disputes/list.test.ts` (or the existing disputes test file), `tests/server-fn-guards.test.ts`

**Interfaces — Produces:**
```ts
// corrections/targets.ts
export interface FixWeek { settlementId: number; startsAt: string; endsAt: string
  levels: { lower: number; upper: number }; level: Level; deducted: number; corrected: boolean }
export interface FixTaker { id: number; name: string; weeks: FixWeek[] } // weeks newest first, ≤ FIX_WEEKS_MAX
export const FIX_WEEKS_MAX = 8
export function getFixTargets(db: Db | Tx): FixTaker[]               // takers by id
export function fixTargetsHandler(db: Db): FixTaker[] | { error: 'feature_off' }
// settlement/week.ts
export interface WeekAdjustment { id: number; points: number; reason: string; at: string
  /** The corrected week's dates, for an adjustment from a correction; null for a manual one. */
  fromWeek: { startsAt: string; endsAt: string } | null
  /** Manual adjustments only: its dispute mark. */ dispute: DisputeMark | null }
// WeekTaker gains `adjustments: WeekAdjustment[]` (made_at >= period start; [] without a period: all of his)
// HistoryRecord gains `adjustments: WeekAdjustment[]` (made_at in [startsAt, endsAt)) and
//   `correction: { level: Level; deducted: number; reason: string } | null` (latest by id)
```

- [ ] **Step 1: failing tests**
  - `getFixTargets`: two boys, three settled weeks for Starší → his `weeks` newest first; a corrected week shows the corrected level/deducted and `corrected: true`; nine weeks → 8 returned; givers and the admin not listed.
  - `fixTargetsHandler` with the switch off → `{ error: 'feature_off' }`; shape pinned with `toStrictEqual` (no reason, no user fields beyond id/name).
  - `tests/server-fn-guards.test.ts`: `getFixTargetsFn` listed as admin.
  - `getWeek`: an adjustment at exactly `period.startsAt` is in `takers[i].adjustments`, one 1 ms before is not (it is in the previous week's record `adjustments`); a correction's adjustment has `fromWeek` = that settlement's week and `dispute: null`; a manual one with an open dispute has its open mark; Starší as viewer gets no row of Mladší's adjustments (`takers` holds only him).
  - `getWeek` history: a corrected record has `correction` = latest correction; uncorrected → `null`.
  - `listAdminDisputes`: entry `takerId` equals the item's taker; score dispute → `null`.
  - Nit from #220 Tests r2: `listDisputes` for Starší on Mladší's **task** dispute that Starší opened keeps its title (kills the `itemKind === 'adjustment'` → `true` mutant at `list.ts:110`).
- [ ] **Step 2:** run `pnpm test src/server/corrections src/server/settlement/week.test.ts src/server/disputes tests/server-fn-guards.test.ts` → FAIL (missing exports/fields).
- [ ] **Step 3:** implement. `getFixTargets` reads `settlements` joined to `periods` per taker, ordered by `periods.startsAt` desc, limit 8, effective value via `latestCorrection` (corrections/read.ts). Week adjustments: one select of `pointAdjustments` for the visible taker ids; `fromWeek` via `correctionId → settlementCorrections → settlements → periods`; dispute marks through the existing `disputeMarks` for `{kind:'adjustment'}` of manual ones only.
- [ ] **Step 4:** same command → PASS; `pnpm typecheck`.
- [ ] **Step 5:** commit "Read fix targets and adjustments for the screens".

### Task 2: Strings, errors and the send call

**Files:**
- Modify: `src/lib/strings.ts` (`cs.admin.fix`, `cs.week.adjustment*`)
- Create: `src/lib/fixErrors.ts` (`fixErrorMessage(error: string): string`)
- Create: `src/components/admin/fixCalls.ts` (`sendFix`)
- Test: `src/lib/fixErrors.test.ts`, `src/components/admin/fixCalls.test.ts`

**Interfaces — Produces:**
```ts
export type FixRequest =
  | { mode: 'week'; input: CorrectSettlementInput }
  | { mode: 'points'; input: AdjustPointsInput }
export type FixOutcome = { ok: true } | { ok: false; message: string; reload: boolean }
export async function sendFix(calls: { correct: CorrectCall; adjust: AdjustCall }, req: FixRequest): Promise<FixOutcome>
```
Czech texts (exact): section „Opravy bodů“; buttons „Upravit body“, „Opravit týden“, „Opravit“ (Sporné row, aria `Opravit: <what> – <name>`); modes „Přidat“ / „Ubrat“; labels „Kdo“, „Týden“, „Úroveň“ (Žádná / Dolní / Horní, from `levelLabel`), „Body“, „Důvod“; hint „Důvod uvidí rodina u úpravy.“ and on a dispute „Důvod uvidí rodina i jako odpověď na rozpor.“; send `Přidat ${n} b. – ${name}`, `Ubrat ${n} b. – ${name}`, `Opravit na ${level} – ${name}`; busy „Ukládám…“; done toast „Opraveno.“. Errors: `week_waiting` „Týden čeká na schůzku. Body teď jde jen přidat.“, `would_go_negative` „Tolik bodů nemá. Celkem by šel pod nulu.“, `no_change` „Týden už tuhle úroveň má.“, `value_changed` / `not_open` / `not_found` as `cs.admin.disputes.errors`, `reason_required` „Napiš důvod.“, `feature_off` and anything else as `cs.disputes.errors`. Week rows: chip „Úprava“, meta „Z opravy týdne <weekLabel>“, history „Opraveno na <level>, původně <level> · <reason>“.

- [ ] **Step 1: failing tests** — `fixErrorMessage` for each code above, unknown → generic; `sendFix` calls only the matching function with `{ data: input }`, maps `ok`, marks `reload: true` for `value_changed`/`not_open`/`not_found` only, a thrown call → generic message, `reload: false`.
- [ ] **Step 2:** `pnpm test src/lib/fixErrors.test.ts src/components/admin/fixCalls.test.ts` → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** → PASS. **Step 5:** commit "Add fix texts, error messages and the send call".

### Task 3: The fix sheet

**Files:**
- Create: `src/components/admin/FixForm.tsx` (pure, no hooks), `src/components/admin/FixDrawer.tsx` (state + Drawer)
- Test: `src/components/admin/fix.test.tsx`

**Interfaces — Produces:**
```ts
export type FixStart =
  | { mode: 'points'; takerId: number | null; dispute: AdminDisputeEntry | null }
  | { mode: 'week'; takerId: number | null; settlementId: number | null; dispute: AdminDisputeEntry | null }
export function FixDrawer(props: { open: boolean; onOpenChange(o: boolean): void; start: FixStart | null
  targets: FixTaker[]; onDone(outcome: FixOutcome): void }): JSX.Element
```
Form: from a dispute, a summary block (what, value now, reason) like DisputeForm's; *Kdo* as a radio-pill row of boys (locked when the dispute names one); *points*: Přidat/Ubrat pills + `inputMode="numeric"` input (min 1, max 9999); *week*: week list (radio rows, effective level shown, „opraveno“ when corrected; locked from a settlement dispute) then Úroveň pills (the current level disabled); Důvod textarea (maxLength 1000); hint; send button disabled until complete; busy state; error under the form. Long reasons/names `break-words`.

- [ ] **Step 1: failing tests** — points mode: send disabled until boy, number 1–9999 and reason; „Ubrat“ sends `points: -5`; from a completion dispute the boy is preselected and locked and `from = { disputeId, seen: entry.value }`; a score dispute leaves the boy to pick. Week mode: from a settlement dispute the week is fixed, the current level is disabled, send text „Opravit na Horní – Starší“; direct: picking a boy lists his weeks. A refusal keeps the sheet open with the reason and shows the message; `reload: true` calls `onDone`. Every tappable has `min-h-tap`. Busy: button `aria-busy` and „Ukládám…“.
- [ ] **Step 2:** `pnpm test src/components/admin/fix.test.tsx` → FAIL.
- [ ] **Step 3:** implement. **Step 4:** → PASS. **Step 5:** commit "Add the fix sheet".

### Task 4: Správa

**Files:**
- Modify: `src/components/admin/DisputesCard.tsx` (Opravit beside Ponechat, `onFix(entry)`)
- Create: `src/components/admin/FixCard.tsx` (section „Opravy bodů“: Upravit body, Opravit týden; load error + retry)
- Modify: `src/routes/_app/sprava.tsx` (loader adds `loadFixTargets(() => getFixTargetsFn())`, state for the sheet, toast + `router.invalidate()` on done)
- Test: `src/components/admin/disputesCard.test.tsx`, `src/components/admin/spravaPage.test.tsx`

- [ ] **Step 1: failing tests** — Sporné row has „Opravit“ with its aria label, tapping calls `onFix` with the entry; settlement entry → `{mode:'week', settlementId, takerId}`, completion → `{mode:'points', takerId}` (helper `fixStartOf(entry)` in FixCard.tsx). FixCard: two buttons; targets load failure → alert + „Zkusit znovu“; switch off → no section (page test through the real route component, like the existing Sporné page test).
- [ ] **Step 2:** `pnpm test src/components/admin` → FAIL. **Step 3:** implement. **Step 4:** → PASS. **Step 5:** commit "Fix points and weeks from Správa".

### Task 5: The family's view on Týden

**Files:**
- Modify: `src/components/week/WeekScreen.tsx`, `src/components/week/weekView.ts`, `src/components/disputes/disputeProps.ts` (`adjustmentDispute`, `recordDispute` uses the effective level)
- Test: `src/components/week/week.test.tsx`, `src/components/disputes/disputeProps.test.ts`

- [ ] **Step 1: failing tests** — Tento týden: a manual adjustment row (reason as name, signed points „+5“/„−3“, chip „Úprava“, Rozporovat when the switch is on, its mark when disputed); a correction's row shows „Z opravy týdne …“ and no Rozporovat. Historie: corrected record's badge shows the corrected level and the „Opraveno na …“ line; its Rozporovat value uses the corrected numbers; the week's adjustments listed under the record. Switch off → no Rozporovat (rows still render: none can exist). 1000-char reason renders whole (`break-words`, no `truncate`).
- [ ] **Step 2:** `pnpm test src/components/week src/components/disputes` → FAIL. **Step 3:** implement. **Step 4:** → PASS. **Step 5:** commit "Show corrections and adjustments on Týden".

### Task 6: Demo piece, e2e and keyboard

**Files:**
- Modify: `src/server/demo/pieces.ts` (`corrections` piece, after `disputes`), `src/server/demo/seeds.ts` (add to `demo`; new seed `corrections: { pieces: [pastWeek, thisWeek, disputes, corrections], features: ['week', 'disputes'] }`)
- Create: `e2e/corrections.spec.ts`; Modify: `e2e/suites.ts` (row `corrections`), `e2e/keyboard.spec.ts` (fix sheet, both modes)
- Test: `src/server/demo/*.test.ts` (existing seed tests), the e2e specs

Piece (through `adjustPointsIn` / `correctSettlementIn`, so audit entries exist; it throws if either refuses): the admin adds „Pomohl s nákupem navíc“ +5 for Starší (manual, made now) and corrects Mladší's past week one level down (a raise could push him below zero), reason „Zapomněli jsme na vynesený koš“. Starší opens a dispute on his own adjustment („Bylo to za 10“), so Sporné shows Opravit on an adjustment.

- [ ] **Step 1: failing tests** — seed test: `demo` and `corrections` seeds build; the piece writes one correction, two adjustments, one open adjustment dispute. e2e: (a) admin: Sporné → Opravit on the adjustment dispute → Přidat 5 with reason → toast, row gone, dispute shows „Správce opravil: …“ for Starší on Historie; (b) admin: Upravit body → Mladší, Ubrat 2 → Mladší's Týden shows „−2“ row; (c) admin: Opravit týden → Starší's past week → Horní → his Historie badge shows Horní; (d) keyboard: the Důvod field is visible with the keyboard open in both modes.
- [ ] **Step 2:** `pnpm test src/server/demo` and `pnpm exec playwright test e2e/corrections.spec.ts e2e/keyboard.spec.ts --trace off` → FAIL.
- [ ] **Step 3:** implement. **Step 4:** → PASS (also `pnpm lint`, `pnpm typecheck`, `pnpm format:check`). **Step 5:** commit "Add the corrections demo piece and e2e".

Screenshots for the UX judge and the brief (360×800 and 393×852@3x): Sporné with Opravit; sheet points mode from a dispute (long reason); sheet week mode direct; refusal message; Týden row for a manual and a correction adjustment; Historie corrected record; keyboard-open sheet.
