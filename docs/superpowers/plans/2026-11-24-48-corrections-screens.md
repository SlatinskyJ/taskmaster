# Settlement correction and manual point adjustment: screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#48 Settlement correction and manual point adjustment](https://github.com/SlatinskyJ/taskmaster/issues/48) (this PR closes it). Stacked on [#220 Settlement correction and manual point adjustment: server](https://github.com/SlatinskyJ/taskmaster/pull/220) (branch `48-corrections`).

**Goal:** The admin fixes a settled week or adds/takes points on Správa (directly, or with "Opravit" on a Sporné row), and the family sees corrections and adjustments on Týden and can dispute a manual adjustment.

**Architecture:** One fix bottom sheet (`FixDrawer`, vaul) with two modes, *week* (pick a level) and *points* (Přidat/Ubrat + number), on top of PR A's `correctSettlementFn` / `adjustPointsFn`. One new admin read (`getFixableFn`) gives the sheet its takers, their current totals and their recent settled weeks. Týden's read (`getWeek`) gains the adjustments and each settlement's latest correction, read through the leaf `~/server/corrections/read` only; WeekScreen renders them. Everything stays behind the `disputes` switch.

**Tech Stack:** TanStack Start server functions, React, vaul Drawer, Tailwind v4, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.7 (a taker sees only his own), §5.9 (corrections, adjustments), §5.11 (disputes: Correct; everyone involved sees the outcome), §6 (admin console); UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §7.5 ADisputes ("keep or correct"), AFix ("Settlement correction or point adjustment; reason required"), §7.1 TWeek; mockups AFix and TWeek on the "Taskmaster Screens" artifact.

**Size:** about 750 changed lines outside tests, migrations and generated files (no migration). Over 400 because it is the one user-facing step of #48: the admin's form and the family's view must ship together, or a correction would change a boy's total with nothing on his screen explaining it. Under 800.

## Global Constraints

- UI text Czech, only in `src/lib/strings.ts`; code English. Level names only from `levelLabel` (`cs.meeting.level`: „Bez kapesného“ / „Spodní hranice“ / „Horní hranice“); points written `b.` as elsewhere in the app.
- Behind the `disputes` switch: with it off, Správa shows no fix section and no Opravit, Týden shows no Rozporovat on adjustment rows (no adjustment can exist with it off).
- Reason 1–1000 characters (`FIX_REASON_MAX`), points a whole number 1–9999 (`ADJUST_POINTS_MAX`), sign from Přidat/Ubrat.
- Dates through `src/domain/dates.ts` (`weekLabel` etc.).
- Tap targets ≥ 44 px (`min-h-tap`, `size-tap`); `motion-reduce:` on any transition added.
- The field being typed into stays visible with the phone keyboard open (CLAUDE.md "Forms on a phone"): bottom sheet, cases in `e2e/keyboard.spec.ts`.
- Import direction (`src/server/corrections/README.md`): corrections → disputes, settlement. `settlement/week.ts` and `disputes/targets.ts` import only the leaf `~/server/corrections/read`.
- A taker's reads never carry another boy's ids or reasons (`takerId` goes only on the admin entry).
- Feature PR: demo piece in `demo`, own e2e suite row with its own seed.

## Rulings (open spec calls; go in the brief)

1. **Direct correction exists on Správa**, not only from a dispute (spec §5.9 "Only the admin can correct a settlement"; UI doc AFix is its own screen). The direct path lists each boy's last 8 settled weeks (`FIX_WEEKS_MAX`), newest first, with their *effective* level; older weeks are corrected through a dispute. A settlement with an open dispute is always listed, however old, so Opravit always finds it. Cost if wrong: raise the cap.
2. **Opravit on a settlement dispute opens week mode on that settlement**; on any other dispute it opens points mode with the item's boy preselected (a score dispute has no boy: the admin picks one). From a settlement dispute the admin cannot switch to points mode. Cost if wrong: one extra UI path later.
3. **No extra confirm dialog.** The sheet previews the effect before sending (week mode: the point difference; points mode: „Starší: 62 → 57 b.“), the send button names the action („Ubrat 5 b. – Starší“, „Opravit na Horní hranice – Starší“), and the hint says the family reads the reason. A fix can itself be corrected or offset.
4. **Where the family sees adjustments** (same windows the points total uses): Týden → Tento týden lists every adjustment made since his latest settled week ended; those made before the current week started are marked „Čeká na schůzku“ (they sit in `unsettled`). Historie lists, under each boy's week record, the adjustments made in that week, and the record's latest correction. Rozporovat only on a **manual** adjustment; one from a correction says „Z opravy týdne …“ and is disputed via its settlement (spec §5.11 locked items).
5. **A settlement record on Historie** shows its effective level (badge); `historyLine` keeps the numbers as settled (total, deducted, carry: what the meeting did); when corrected, a line below says „Opraveno na Horní hranice (původně Spodní hranice): −50 b. 20. 11. · <důvod>“, the net difference between the original deduction and the latest one, dated by the latest correction. Its dispute value is the effective one (matches PR A).
6. **An adjustment row is named „Úprava od správce“** (or „Oprava týdne“ for one from a correction), with the reason as the detail line under it, so a 1000-character reason never becomes the bold row title.

## Review Focus

1. A stale Sporné row (`value_changed` / `not_open` / `not_found`) reloads the list and closes the sheet, but keeps the typed reason as a draft for the next Opravit on the same dispute.
2. `week_waiting` / `would_go_negative` refusals keep the sheet open with the typed reason and a Czech message.
3. A taker never sees another boy's adjustment rows, reasons or ids on Týden (Tento týden and Historie).
4. Long Czech reason (1000 chars) and long names at 360 px in the sheet, on Sporné and on Týden rows: wrap, never cut.
5. An adjustment exactly at a week's start belongs to that week only (not also the week before).

---

### Task 1: Server reads

**Files:**
- Modify: `src/server/disputes/list.ts` (`listOpenForAdmin` adds `takerId: number | null` to `AdminDisputeEntry`; `describe().entry` unchanged)
- Modify: `src/server/corrections/read.ts` (`latestCorrections`, `correctionWeeks`), `src/server/corrections/README.md` (week.ts as a new importer of `./read`)
- Create: `src/server/corrections/fixable.ts` (`getFixable`)
- Modify: `src/server/corrections/functions.ts`, `index.ts` (`fixableHandler`, `getFixableFn`, GET, admin only)
- Modify: `src/server/settlement/week.ts` (adjustments + corrections in `Week`, through `~/server/corrections/read` only)
- Test: `src/server/corrections/fixable.test.ts`, `src/server/corrections/functions.test.ts`, `src/server/settlement/week.test.ts`, the existing disputes list test file, `tests/server-fn-guards.test.ts`

**Interfaces — Produces:**
```ts
// corrections/read.ts (leaf: schema + domain only)
export function latestCorrections(db: Db | Tx, settlementIds: number[]): Map<number, SettlementCorrectionRow> // highest id per settlement
export function correctionWeeks(db: Db | Tx, correctionIds: number[]): Map<number, { startsAt: string; endsAt: string }>
// corrections/fixable.ts
export const FIX_WEEKS_MAX = 8
export interface FixWeek { settlementId: number; startsAt: string; endsAt: string
  levels: { lower: number; upper: number }; totalBefore: number; carryOver: number
  level: Level; deducted: number; corrected: boolean }          // level/deducted effective
export interface FixTaker { id: number; name: string; total: number; weeks: FixWeek[] }
// total = takerPointsNow confirmed; weeks newest first: the newest FIX_WEEKS_MAX plus any with an open dispute
export function getFixable(db: Db | Tx): FixTaker[]            // takers by id
// corrections/functions.ts
export function fixableHandler(db: Db): FixTaker[] | { error: 'feature_off' }
export const getFixableFn
// settlement/week.ts
export interface WeekAdjustment { id: number; points: number; reason: string; at: string
  fromWeek: { startsAt: string; endsAt: string } | null        // set for one from a correction
  waiting: boolean                                              // made before the current week started
  dispute: { item: { kind: 'adjustment'; id: number }; mark: DisputeMark | null } | null } // manual only
// WeekTaker gains `adjustments: WeekAdjustment[]`: made_at >= his latest settled week's end (no settlement: all), oldest first.
// HistoryRecord gains `adjustments: WeekAdjustment[]` (his, made_at in [startsAt, endsAt), waiting false)
//   and `correction: { level: Level; deducted: number; reason: string; at: string } | null` (latest by id)
```

- [ ] **Step 1: failing tests**
  - `getFixable`: Starší and Mladší both with settled weeks → each `weeks` holds only his own (`settlementId`s compared); newest first; a week corrected twice shows the *second* correction's level/deducted and `corrected: true`; nine weeks for Starší → the 8 newest (`startsAt` of all 8 asserted, the oldest absent); the 9th-oldest with an open dispute → listed as well; `total` equals `takerPointsNow` confirmed; givers and the admin not listed; a boy with no settlement → `weeks: []`.
  - `fixableHandler` switch off → `{ error: 'feature_off' }`; on → shape pinned with `toStrictEqual` (no reason, no user fields beyond id/name/total).
  - `tests/server-fn-guards.test.ts`: `getFixableFn` listed as admin.
  - `getWeek` this week: an adjustment at exactly `period.startsAt` is in `takers[i].adjustments` with `waiting: false` and in no history record; one 1 ms before, in an ended unsettled week, is there with `waiting: true`; one inside a settled week is only in that week's record; a correction's adjustment has `fromWeek` = the corrected settlement's week and `dispute: null`; a manual one with an open dispute carries its open mark; no running period → all his adjustments since his latest settlement.
  - `getWeek` privacy: viewer Starší, both boys with adjustments in this week and in a settled week → his `takers` and every `history[].records[]` hold only his rows (no Mladší id or reason anywhere in the JSON); viewer Táta → each record's `adjustments` only that record's boy.
  - `getWeek` history: a record corrected twice → `correction` is the second one (level, deducted, reason); uncorrected → `null`.
  - `listOpenForAdmin`: entry `takerId` equals the item's taker; score dispute → `null`. `listDisputes` for a taker carries no `takerId` key.
  - Nit carried from #220 (Tests r2): `listDisputes` for Starší on a task dispute he opened on Mladší's item keeps its title (kills `itemKind === 'adjustment'` → `true` at `list.ts:110`).
- [ ] **Step 2:** `pnpm test src/server/corrections src/server/settlement/week.test.ts src/server/disputes tests/server-fn-guards.test.ts` → FAIL (missing exports/fields).
- [ ] **Step 3:** implement. `getFixable` per taker: settlements joined to periods ordered by `periods.startsAt` desc, limit 8, plus settlement ids with an open `settlement` dispute; effective values via `latestCorrections`. week.ts: one select of `pointAdjustments` for the visible taker ids, split by window; `fromWeek` via `correctionWeeks`; marks through the existing `disputeMarks` for manual ones only.
- [ ] **Step 4:** same command → PASS; `pnpm typecheck`.
- [ ] **Step 5:** commit "Read fixable weeks and adjustments for the screens".

### Task 2: Strings, errors and the send call

**Files:**
- Modify: `src/lib/strings.ts` (`cs.admin.fix`, `cs.week.adjustment*`)
- Create: `src/lib/fixErrors.ts` (`fixErrorMessage(error: string): string`)
- Modify: `src/components/disputes/disputeCalls.ts` (export `STALE`; `DismissOutcome` renamed `AdminOutcome`, Ponechat keeps using it)
- Create: `src/components/admin/fixCalls.ts` (`sendFix`)
- Test: `src/lib/fixErrors.test.ts`, `src/components/admin/fixCalls.test.ts`, existing `disputeCalls.test.ts` still green

**Interfaces — Produces:**
```ts
export type FixRequest =
  | { mode: 'week'; input: CorrectSettlementInput }
  | { mode: 'points'; input: AdjustPointsInput }
export async function sendFix(calls: { correct: CorrectCall; adjust: AdjustCall }, req: FixRequest): Promise<AdminOutcome>
```
Czech texts (exact): section „Opravy bodů“; buttons „Upravit body“, „Opravit týden“, „Opravit“ (Sporné row, aria `Opravit: <what> – <name>`); modes „Přidat“ / „Ubrat“; labels „Kdo“, „Týden“, „Úroveň“ (from `levelLabel`), „Body“, „Důvod“; preview points `${name}: ${before} → ${after} b.`, week `Rozdíl: ${signed} b. k dnešku` (`signed` = current effective deducted − new deducted, e.g. „−50“, „+50“); week row line as `historyLine` plus „opraveno“ when corrected; hint „Důvod uvidí rodina u úpravy.“ and on a dispute „Důvod uvidí rodina i jako odpověď na rozpor.“; send `Přidat ${n} b. – ${name}`, `Ubrat ${n} b. – ${name}`, `Opravit na ${levelLabel} – ${name}`; busy „Ukládám…“; done toast „Opraveno.“; empty „Zatím žádný uzavřený týden.“, „Nikdo tu nesbírá body.“; load error „Opravy se nenačetly.“ + „Zkusit znovu“. Errors: `week_waiting` „Týden čeká na schůzku. Body teď jde jen přidat.“, `would_go_negative` „Tolik bodů nemá. Celkem by šel pod nulu.“, `no_change` „Týden už tuhle úroveň má.“, `value_changed` / `not_open` / `not_found` as `cs.admin.disputes.errors`, `reason_required` „Napiš důvod.“, `feature_off` and anything else as `cs.disputes.errors`. Week rows: name „Úprava od správce“ / „Oprava týdne“, detail = reason, meta `Z opravy týdne ${weekLabel}` and „Čeká na schůzku“; history correction line `Opraveno na ${new} (původně ${old}): ${signed} b. ${date} · ${reason}`.

- [ ] **Step 1: failing tests** — `fixErrorMessage` for each code above, unknown → generic; `sendFix` calls only the matching function with `{ data: input }`, maps `ok`, `reload: true` exactly for the `STALE` codes, a thrown call → generic message with `reload: false`.
- [ ] **Step 2:** `pnpm test src/lib/fixErrors.test.ts src/components/admin/fixCalls.test.ts src/components/disputes` → FAIL.
- [ ] **Step 3:** implement. **Step 4:** → PASS. **Step 5:** commit "Add fix texts, error messages and the send call".

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
  fixable: FixTaker[]; draft: string; onDraft(reason: string): void; onDone(outcome: AdminOutcome): void }): JSX.Element
```
Form: from a dispute, a summary block (what, value now, reason) like DisputeForm's; *Kdo* as wrapping radio pills (locked when the dispute names one); *points*: Přidat/Ubrat pills + `inputMode="numeric"` input, then the preview; *week*: week list (radio rows with `weekLabel`, effective level, the `historyLine`, „opraveno“; locked from a settlement dispute) then Úroveň pills (the current level disabled), then the difference preview; Důvod textarea (maxLength 1000, value from `draft`); hint; send button disabled until complete; busy state; error under the form; empty texts when no taker / no week. Long reasons/names `break-words`. Správa keeps `draft` per dispute id (or the direct sheet) and clears it only after a successful send.

- [ ] **Step 1: failing tests**
  - points mode: send disabled until boy, number and reason; number 0 and 10000 keep it disabled, 1 and 9999 enable it; „Ubrat“ sends `points: -5`; preview „Starší: 62 → 57 b.“; from a completion dispute the boy is preselected and locked and the call gets `from = { disputeId: entry.id, seen: entry.value }`; a score dispute leaves the boy to pick.
  - week mode from a settlement dispute: the week is fixed, the current level disabled, send text „Opravit na Horní hranice – Starší“, preview „Rozdíl: −50 b. k dnešku“, and the call gets `{ settlementId, level: 'upper', reason, from: { disputeId: entry.id, seen: entry.value } }`; direct: picking a boy lists only his weeks and sends `from: null`; a boy with no week → „Zatím žádný uzavřený týden.“, no boys → „Nikdo tu nesbírá body.“.
  - A refusal keeps the sheet open with the reason and shows the message; `reload: true` calls `onDone` and the draft is still there when the sheet reopens for the same dispute. Every tappable has `min-h-tap`. Busy: `aria-busy` and „Ukládám…“.
- [ ] **Step 2:** `pnpm test src/components/admin/fix.test.tsx` → FAIL.
- [ ] **Step 3:** implement. **Step 4:** → PASS. **Step 5:** commit "Add the fix sheet".

### Task 4: Správa

**Files:**
- Modify: `src/components/admin/DisputesCard.tsx` (Opravit beside Ponechat, `onFix(entry)`)
- Create: `src/components/admin/FixCard.tsx` (section „Opravy bodů“: Upravit body, Opravit týden; load error + retry; `fixStartOf(entry): FixStart`; `loadFixable`)
- Modify: `src/routes/_app/sprava.tsx` (loader adds `loadFixable(() => getFixableFn())`, sheet state, drafts, toast + `router.invalidate()` on done)
- Test: `src/components/admin/disputesCard.test.tsx`, `src/components/admin/spravaPage.test.tsx`

- [ ] **Step 1: failing tests** — Sporné row has „Opravit“ with its aria label; tapping calls `onFix` with the entry; `fixStartOf`: settlement entry → `{ mode: 'week', settlementId: entry.item.id, takerId: entry.takerId }`, completion → `{ mode: 'points', takerId }`, score → `takerId: null`. FixCard: two buttons; load failure → alert + „Zkusit znovu“ calling retry; switch off → no section and no Opravit (page test through the real route component, like the existing Sporné page test).
- [ ] **Step 2:** `pnpm test src/components/admin` → FAIL. **Step 3:** implement. **Step 4:** → PASS. **Step 5:** commit "Fix points and weeks from Správa".

### Task 5: The family's view on Týden

**Files:**
- Modify: `src/components/week/WeekScreen.tsx`, `src/components/week/weekView.ts` (`adjustmentRow`, `correctionLine`), `src/components/disputes/disputeProps.ts` (`adjustmentDispute`, `recordDispute` uses the effective level)
- Test: `src/components/week/week.test.tsx`, `src/components/disputes/disputeProps.test.ts`

- [ ] **Step 1: failing tests**
  - `adjustmentDispute(a, takerName)` → `item: { kind: 'adjustment', id: a.id }` (the adjustment's own id, not a task's), `what: cs.disputes.what.adjustment`, value with the signed points; `null` for a correction's adjustment.
  - Tento týden: a manual adjustment row („Úprava od správce“, reason as detail, „+5“/„−3“, Rozporovat when the switch is on, its mark when disputed); a correction's row („Oprava týdne“, „Z opravy týdne …“, no Rozporovat); a waiting one says „Čeká na schůzku“.
  - Historie: a corrected record's badge shows the corrected level, `historyLine` the settled numbers, and the correction line with the signed difference and reason; its Rozporovat value uses the corrected numbers; the week's adjustments are listed under the record.
  - Switch off → no Rozporovat on any adjustment row. A 1000-char reason renders whole (`break-words`, no `truncate`).
- [ ] **Step 2:** `pnpm test src/components/week src/components/disputes` → FAIL. **Step 3:** implement. **Step 4:** → PASS. **Step 5:** commit "Show corrections and adjustments on Týden".

### Task 6: Demo piece, e2e and keyboard

**Files:**
- Modify: `src/server/demo/pieces.ts` (`corrections` piece, after `disputes`), `src/server/demo/seeds.ts` (add to `demo`; new seed `corrections: { pieces: [pastWeek, thisWeek, disputes, corrections], features: ['week', 'disputes'] }`)
- Create: `e2e/corrections.spec.ts`; Modify: `e2e/suites.ts` (row `corrections`), `e2e/keyboard.spec.ts` (fix sheet)
- Test: the existing seed tests, the e2e specs

Piece (through `adjustPointsIn` / `correctSettlementIn`, so audit entries exist; it throws if either refuses): the admin adds „Pomohl s nákupem navíc“ +5 for Starší (manual, made now) and corrects Mladší's past week one level down (a raise could push him below zero), reason „Zapomněli jsme na vynesený koš“. Starší opens a dispute on his own adjustment („Bylo to za 10“), so Sporné shows Opravit on an adjustment.

- [ ] **Step 1: failing tests** — seed test: `demo` and `corrections` seeds build; the piece writes one correction, two adjustments, one open adjustment dispute. e2e: (a) admin: Sporné → Opravit on the adjustment dispute → Přidat 5 with reason → toast, row gone; Starší's Historie → Rozporováno shows „Správce opravil: …“; (b) admin: Upravit body → Mladší, Ubrat 2 → Mladší's Týden shows the „−2“ row; (c) admin: Opravit týden → Starší's past week → Horní hranice → his Historie badge shows Horní hranice and the correction line; (d) Mladší taps Rozporovat on his „−2“ row, sends a reason → the row shows the open chip and Sporné lists it. Keyboard: with the keyboard open, Důvod visible in the direct points sheet, Body and Důvod visible in the sheet opened from a dispute with a long reason, Důvod in week mode.
- [ ] **Step 2:** `pnpm test src/server/demo` and `pnpm exec playwright test e2e/corrections.spec.ts e2e/keyboard.spec.ts --trace off` → FAIL.
- [ ] **Step 3:** implement. **Step 4:** → PASS (also `pnpm lint`, `pnpm typecheck`, `pnpm format:check`). **Step 5:** commit "Add the corrections demo piece and e2e".

Screenshots for the UX judge (360×800) and the brief (393×852@3x): Sporné with Opravit; Opravy bodů card and its load error; sheet points mode from a dispute (long reason) with preview; Kdo pills with long names; sheet week mode direct with the difference; empty week list; refusal message; Týden rows for a manual, a correction and a waiting adjustment; a giver's Týden with both boys' adjustments; Historie corrected record with adjustments under it; keyboard-open sheets.
