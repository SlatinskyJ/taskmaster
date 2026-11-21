# Change score, cancel task and task history — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (CLAUDE.md PR flow step 3). Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#36 Change score, cancel task and task history](https://github.com/SlatinskyJ/taskmaster/issues/36)

**Goal:** On a one-time task's page, the right people can propose and agree a new score, a giver can cancel the task, and everyone sees the task's history built from the audit log.

**Architecture:** The §5.2 change rules and §5.6 cancel already live in `src/domain/scoreChange.ts` and `src/domain/lifecycle.ts` (`proposeOneTimeScoreChange`, `approveOneTimeScoreChange`, `resolveOneTimeChange`, `cancelItem`). This PR adds the one missing rule (saying no), stores a change in two new tables, runs it through a new server module `src/server/tasks/scoreChange.ts`, adds `cancelTask` to the existing `runStep` in `src/server/tasks/lifecycle.ts`, reads history from `audit_log` for `entity_type='task'`, and puts three panels on `/ukol/$taskId` plus a row in "Čeká na tebe".

**Tech Stack:** TanStack Start server functions, Drizzle + SQLite, React, Tailwind, shadcn Dialog/Drawer, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §3 (score agreement), §5.2 "Changing the score of an agreed one-time task", §5.6 (cancel [call]), §5.10 (audit, never delete). UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §5 (Dialog only for actions that can't be undone: cancel task), §7.2 GTask, §7.1 TApprove ("a price change"). Mockup artboards GTask and TApprove in the Screens artifact (UI doc line 8).

**Scope note (launch, Jakub 2026-11-21):** recurring chores are hidden for the family launch, so this PR covers one-time tasks only. Instances get cancel later with #38.

**Size:** about 650 changed lines outside tests, migrations and generated files (domain 40, schema 50, server 300, UI 260). Over the 400 goal because score change, cancel and history are one screen (GTask) and one issue; a stack would double the plan rounds while the family starts using the app on 2026-11-22. Under 800.

## Global Constraints

- UI labels Czech, only in `src/lib/strings.ts`. Code, identifiers, DB, commits English.
- Every state change goes through one transaction with its audit entry (`writeAudit`); a failed audit write rolls the whole step back.
- Never delete domain data: a change closes with `closed_at` + `closed_as`; a cancelled task stays a row with `status='cancelled'` (§5.10).
- Scores are whole numbers 1..`TASK_SCORE_MAX` (999); reasons ≤ `REASON_MAX` (200) characters, trimmed, blank = none.
- Dates stored as UTC ISO (`toIsoUtc`); shown in Prague time through `src/domain/dates.ts`.
- `src/domain/` stays framework-free.
- Don't design for users becoming inactive (Jakub 2026-11-17): no people-change hook for score changes; approvals are still counted live by the existing domain functions.
- Touch targets ≥ 44 px (`min-h-tap`, `size-tap`); transitions have `motion-reduce:`; screens work at 360 px.

## Rules this PR implements (from the spec, restated so the judges can check)

| Task state | Who may propose | Agreed when (live, proposer counts) |
| --- | --- | --- |
| `open` | any party (giver or taker) | score agreement: one giver + one taker approved |
| `reserved` | the reserving taker or any giver | the reserving taker + one giver approved |
| `proposed` | nobody (`not_agreed`; bidding handles it) | — |
| `done_unconfirmed`, `confirmed` | nobody (`score_frozen`) | — |
| `cancelled` | nobody (`not_changeable`) | — |

- One open change per task (`change_pending`). The old score stays in force until agreed; then `tasks.score` becomes the new score.
- A change still open when the task leaves `open`/`reserved` (done, released back to negotiation, cancelled) closes as `discarded` in the same transaction (domain `resolveOneTimeChange` returns `null`).
- Cancel: only a giver, only from `proposed`, `open`, `reserved` (domain `cancelItem`). Optional reason, shown to everyone in the history. Asks first (Dialog). A cancelled proposed task closes its negotiation thread (existing `saveItem`).

**Saying no — DECIDED by Jakub 2026-11-21 (decision card): option 1.** The spec is silent on rejecting a change; without it one ignored proposal would block the task's price forever (one change at a time). The approved mockup TApprove "Změna ceny" has a "Nesouhlasím" button. Options put to Jakub: (1) only the people the change waits for (`oneTimeChangeWaitingFor`) may say no, the proposer may withdraw; (2) anyone who could approve may say no; (3) withdraw only. **Jakub chose option 1:** "Nesouhlasím" by someone the change waits for → `declined`; "Stáhnout návrh" by the proposer → `withdrawn`; anyone else → `not_involved`. The old score stays.

**[call] Who sees history.** Everyone who can open the task page (givers and takers). Reasons are visible to all, as the mockup says ("Důvod (uvidí ho všichni)").

## Review Focus

1. A giver proposes a new price on a reserved task and a *different* brother taps "Souhlasím" from a stale screen → refused (`not_involved`); the price does not change.
2. A change is pending and the brother marks the task done → the change is discarded, the task keeps the old score, and the "Čeká na tebe" row disappears.
3. Two screens: the giver withdraws a change while the brother approves it → the approve is refused (`no_change` / `offer_changed` by change id), never applied to a later change.
4. Cancel a reserved task the brother is about to finish → his Hotovo is refused (`wrong_state`); the cancelled task disappears from Domů and the board.
5. History of a task with 15+ entries and a 200-character reason → every line wraps at 360 px, nothing cut.

---

### Task 1: Domain — saying no, and who a change waits for

**Files:**
- Modify: `src/domain/scoreChange.ts`
- Test: `src/domain/scoreChange.test.ts`

**Interfaces:**
- Produces:
  - `declineOneTimeScoreChange(item: Item, change: ScoreProposal, people: readonly Person[], userId: PersonId): Result<'declined' | 'withdrawn', AgreementError>` — checks in this order: `changeRule` error (frozen/proposed/cancelled); not an active party (admin, unknown) → `not_a_party`; proposer → `'withdrawn'` (even after the task's rule changed); `userId` in `oneTimeChangeWaitingFor(item, change, people)` → `'declined'`; anyone else (an approver, a non-reserving taker on a reserved task, a second taker on an open task whose taker side already said yes) → `not_involved`.
  - `oneTimeChangeWaitingFor(item: Item, change: ScoreProposal, people: readonly Person[]): PersonId[]` — the active people whose yes would still count: `open` → active people of each role in `missingRoles`; `reserved` → the reserving taker if he hasn't approved, plus every active giver if no giver approved; `[]` if `changeRule` fails. Ordered as in `people`.

- [ ] **Step 1: Write failing tests** in `scoreChange.test.ts` (`describe('declineOneTimeScoreChange')`, `describe('oneTimeChangeWaitingFor')`):
  - proposer (giver, open task) → `ok('withdrawn')`; a taker on the open task → `ok('declined')`; admin → `fail('not_a_party')`.
  - open task, Starší proposed: Mladší → `fail('not_involved')` (Starší's yes already covers the taker side); Táta → `ok('declined')`.
  - reserved to Starší, giver proposed: Mladší → `fail('not_involved')`; Starší → `ok('declined')`.
  - an approver who is not the proposer (Máma added; open task, Táta proposed, Máma approved) → Máma `fail('not_involved')`.
  - item `done_unconfirmed` → `fail('score_frozen')`; `proposed` → `fail('not_agreed')`; `cancelled` → `fail('not_changeable')`.
  - waitingFor: open, giver proposed → `[starsi, mladsi]`; open, Starší proposed → `[tata]` (with Máma added: `[tata, mama]`); reserved to Starší, giver proposed → `[starsi]`; reserved, Starší proposed → `[tata]`; fully agreed → `[]`; confirmed item → `[]`.
- [ ] **Step 2:** `pnpm test src/domain/scoreChange.test.ts` → FAIL (not exported).
- [ ] **Step 3:** Implement both in `scoreChange.ts`, reusing `changeRule`, `isTaker`, `isGiver`, `missingRoles`, `findPerson`/`isParty` from `agreement.ts`/`parties.ts`. Export through `src/domain/index.ts` (already `export *`).
- [ ] **Step 4:** Tests PASS. **Step 5:** Commit `Domain: say no to a task score change`.

### Task 2: Schema — task score changes

**Files:**
- Modify: `src/server/db/schema/tasks.ts`
- Create: `drizzle/0013_task_score_changes.sql` (+ snapshot, journal) via `pnpm db:generate --name task_score_changes`
- Modify: `src/server/audit/actions.ts` (append, never rename)
- Test: `src/server/db/tasks-schema.test.ts` (new; pattern of `templates-schema.test.ts`)

**Interfaces:**
- Produces:
  - `SCORE_CHANGE_CLOSINGS = ['agreed', 'declined', 'withdrawn', 'discarded'] as const`
  - table `taskScoreChanges` (`task_score_changes`): `id` pk autoinc, `taskId` → tasks, `score` int (CHECK ≥ 1), `proposedBy` → users, `createdAt` text, `closedAt` text null, `closedAs` text enum null, `closedBy` → users null. CHECKs: closedAt/closedAs both null or both set and in the list. Partial unique index `task_score_changes_open_idx` on `task_id` WHERE `closed_at IS NULL` (one open change per task). Index on `task_id`.
  - table `taskScoreChangeApprovals` (`task_score_change_approvals`): `changeId` → task_score_changes, `userId` → users, `approvedAt` text; PK (`changeId`, `userId`). Append-only.
  - types `TaskScoreChangeRow`, `TaskScoreChangeApprovalRow`.
  - `AUDIT_ACTIONS` gains `'task.score_change_approved'`, `'task.score_change_declined'`, `'task.score_change_withdrawn'`, `'task.score_change_discarded'` (after `'task.score_changed'`). `task.score_change_proposed` and `task.score_changed` exist already. `audit_log.action` has no CHECK, so no migration for these.

- [ ] **Step 1: Failing schema tests:** a second open change for the same task throws (unique index); two closed + one open is fine; `score = 0` throws; `closed_as` without `closed_at` throws; a duplicate approval (same change, same user) throws.
- [ ] **Step 2:** FAIL (tables missing). **Step 3:** schema + `pnpm db:generate --name task_score_changes`; `pnpm db:check` passes. **Step 4:** PASS. **Step 5:** Commit `Schema: task score changes`.

### Task 3: Server — propose, approve, say no, discard

**Files:**
- Create: `src/server/tasks/scoreChange.ts` (actions), `src/server/tasks/changeRows.ts` (reader, like `./thread`; no import of `./tasks`, so no cycle)
- Modify: `src/server/tasks/lifecycle.ts` (discard in `runStep`), `src/server/tasks/tasks.ts` (`listScoreChangesWaiting` next to `pendingApprovals`)
- Modify: `src/server/tasks/index.ts` (export)
- Test: `src/server/tasks/scoreChange.test.ts`

**Interfaces:**
- Consumes: Task 1 domain functions; Task 2 tables; `toItem` (`./item`); `listPeople`; `writeAudit`.
- Produces:
  - `type ScoreChangeError = AgreementError | 'not_found' | 'no_change'`
  - in `changeRows.ts`: `openChangeOf(tx: Db | Tx, taskId: number): (ScoreProposal & { id: number; createdAt: string }) | null` — the open row + its approvals (oldest first, proposer first).
  - `proposeTaskScoreChange(db: Db, userId: number, taskId: number, score: number, now?: Date): Result<TaskRow, ScoreChangeError>` — inserts change + proposer's approval; audit `task.score_change_proposed` `after: { changeId, score, from: task.score }`. A proposal alone is never agreed (every rule needs two people), so propose never changes `tasks.score`.
  - `approveTaskScoreChange(db, userId, taskId, changeId: number, now?): Result<TaskRow, ScoreChangeError>` — `changeId` must be the open change (else `no_change` when none is open, `offer_changed` when another is); inserts approval; audit `task.score_change_approved` `after: { changeId, score }`; when agreed: the new score is written through `saveItem(tx, row, toItem(row), { set: { score: change.score } }, now)` (the one writer of a task row), close change `agreed` (closedBy = approver), audit `task.score_changed` `before: { score: old }`, `after: { changeId, score }`.
  - `declineTaskScoreChange(db: Db, userId: number, taskId: number, changeId: number, now?: Date): Result<TaskRow, ScoreChangeError>` — same `changeId` check as approve; domain decides `declined`/`withdrawn`; closes the change with that `closedAs`, `closedBy=userId`; audit `task.score_change_declined` or `task.score_change_withdrawn` `after: { changeId, score }`.
  - `discardStaleChange(tx: Tx, row: TaskRow, actor: Actor, now: Date): number | null` — after a lifecycle step: if an open change exists and `resolveOneTimeChange(toItem(row), change, people)` is `null`, close it `discarded` (closedBy = actor's user id or null) and write `task.score_change_discarded` `after: { changeId, score }`; returns the closed change id.
  - `runStep` in `lifecycle.ts` calls `discardStaleChange` after `saveItem`/`extra`, before the step's audit entry, so complete, release and cancel all discard. (Not inside `saveItem`: it has no actor for the audit entry, and `agree`, the only other `saveItem` caller on a non-proposed path, only moves `proposed` → agreed, where no change can exist.)
  - in `tasks.ts`: `listScoreChangesWaiting(db: Db | Tx, userId: number): TaskView[]` — tasks with an open change where `userId` is in `oneTimeChangeWaitingFor`, oldest change first.
- Every function runs in one `db.transaction`; roles checked against `listPeople` inside.

- [ ] **Step 1: Failing tests** (`family()`, `T0..T3`, helper `openTask(f)` = created + approved by Starší, `reservedTask(f)` = open + reserved by Starší):
  - open: Táta proposes 20 → change open, task score still 18; Mladší approves → task score 20, change `agreed`, audits `task.score_change_approved` then `task.score_changed` with `before.score 18`, `after.score 20`.
  - open: Starší proposes 15; Mladší approves → still 18 (needs a giver); Táta approves → 15.
  - reserved to Starší: Táta proposes 20; Mladší approves → `fail('not_involved')`, score 18; Starší approves → 20.
  - reserved: Mladší proposes → `fail('not_involved')`; admin proposes → `fail('not_a_party')`.
  - proposed task → `fail('not_agreed')`; done task → `fail('score_frozen')`; same score → `fail('same_score')`; second proposal while one is open → `fail('change_pending')`; score 0 → `fail('invalid_score')`; unknown task → `fail('not_found')`.
  - stale id: approve with an old change id after a withdraw + new proposal → `fail('offer_changed')`; with none open → `fail('no_change')`.
  - Jakub's rule at the server: open task, Starší proposed 15; Mladší declines → `fail('not_involved')`, change still open, no new audit row.
  - decline by Mladší on open → change `declined`, score unchanged, audit `task.score_change_declined`; proposer → `withdrawn`; then a new proposal is allowed.
  - discard: change open, Starší completes (reserved) → change `discarded`, audit order `task.score_change_discarded` before `task.completed`; bid-won release back to proposed → discarded; tap release reserved → open keeps the change open.
  - rollback: with the audit write failing (same technique as `lifecycle.test.ts:173`), approve-to-agreement leaves score 18, change open, no approval row; propose leaves no change row; discard during complete leaves task reserved and change open.
  - `listScoreChangesWaiting`: Táta proposed on open → returned for Starší and Mladší, not Táta, not admin; after agreement → empty.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + existing `src/server/tasks` tests still pass. **Step 5:** Commit `Server: task score changes`.

### Task 4: Server — cancel and history

**Files:**
- Modify: `src/server/tasks/lifecycle.ts`
- Create: `src/server/tasks/history.ts`; `src/server/audit/read.ts` (`entityLog`, exported from `~/server/audit`)
- Modify: `src/server/tasks/tasks.ts` (`TaskView.scoreChange`, `TaskDetail.history`)
- Test: `src/server/tasks/lifecycle.test.ts`, `src/server/tasks/history.test.ts`

**Interfaces:**
- Produces:
  - `cancelTask(db: Db, userId: number, taskId: number, reason: string | undefined, now?: Date): Result<TaskRow, LifecycleActionError>` — `runStep(..., 'task.cancelled', cancelItem, now, { reason })`; reason trimmed, `reason_too_long` over `REASON_MAX`, blank → none.
  - `HistoryEntry = { id: number; at: string; action: TaskHistoryAction; by: { id: number; name: string } | null; score: number | null; reservedBy: string | null; reason: string | null }` where `TaskHistoryAction` is the `task.*` subset of `AuditAction`.
  - `entityLog(db: Db | Tx, entityType: EntityType, entityId: number | string): AuditLogRow[]` in `src/server/audit/read.ts` — the first reader of the log, reusable by #49 (CSV export); ordered by `id` ascending.
  - `taskHistory(db: Db | Tx, taskId: number): HistoryEntry[]` — via `entityLog(db, 'task', taskId)`: `audit_log` rows with `entity_type='task'` and `entity_id=String(taskId)`, ordered by `id` ascending. `score` = `after.score` when it is a safe integer, else null; `reservedBy` = name of `after.reservedBy` for `task.agreed` only; `reason` = the row's `reason`. Nothing else from `before`/`after` leaves the server. `by` is null for system actors.
  - `TaskView` gains `scoreChange: { id: number; score: number; proposedBy: { id: number; name: string }; approvedBy: { id: number; name: string }[]; waitingFor: { id: number; name: string }[] } | null` (set only for open/reserved tasks with an open change).
  - `TaskDetail` gains `history: HistoryEntry[]`.

- [ ] **Step 1: Failing tests:**
  - cancel: Táta cancels proposed (thread closes, every open row `closed`), open, reserved (with reason "Už to udělala máma." in `audit_log.reason`) → `cancelled`; Starší cancels → `fail('not_a_giver')`; admin → `fail('not_a_giver')` (or `not_allowed`, whatever `runStep` gives, pinned); done/confirmed/cancelled → `fail('wrong_state')`; 201-char reason → `fail('reason_too_long')`, exactly 200 → ok; after cancel `completeTask` by Starší → `fail('wrong_state')`; `listBoard` no longer has it; open change on it → `discarded`; audit failure rolls back (still reserved).
  - history: created → bid → counter → agreed reserved → completed gives actions in that order with scores `[18, 25, 20, 20, 20]`, `reservedBy: 'Starší'` on the agreed entry, `by` names; another task's entries and a `template` entity with the same id are not included; the returned object has exactly the keys of `HistoryEntry` (no `before`/`after`).
  - `getTaskDetail` shape: `history` present; `task.scoreChange` null without a change, and with Táta's open proposal `{ score: 20, proposedBy: Táta, approvedBy: [Táta], waitingFor: [Starší, Mladší] }`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Step 5:** Commit `Server: cancel a task, task history`.

### Task 5: Server functions

**Files:**
- Modify: `src/server/tasks/functions.ts`, `tests/server-fn-guards.test.ts` (`EXPECTED_ROLES`: `cancelTaskFn: giver`; `proposeTaskScoreChangeFn`, `approveTaskScoreChangeFn`, `declineTaskScoreChangeFn`, `listScoreChangesWaitingFn`: `giver, taker`)
- Test: `src/server/tasks/functions.test.ts`

**Interfaces:**
- Produces (all `POST` unless noted, results through the existing `answered`/`done` shapes `{ ok, id, status } | { ok: false, error }`):
  - `proposeTaskScoreChangeFn` — role giver|taker, `parseApproval` ({ taskId, score }).
  - `approveTaskScoreChangeFn`, `declineTaskScoreChangeFn` — role giver|taker, `{ taskId, changeId }` (both ints).
  - `cancelTaskFn` — role giver, `parseReject` ({ taskId, reason? }).
  - `listScoreChangesWaitingFn` — `GET`, giver|taker.
  - `ScoreChangeActionResult` type exported for the UI.
- [ ] **Step 1: Failing tests:** each validator rejects a non-integer id / string score / score 1000 / non-string reason, and accepts score 999 (pattern of the existing tests in this file); the guard test fails until the five entries are in `EXPECTED_ROLES`.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `Server functions: score change and cancel`.

### Task 6: UI — price change on the task page

**Files:**
- Create: `src/components/tasks/ScoreChangePanel.tsx`
- Modify: `src/components/tasks/taskView.ts` (pure helpers)
- Modify: `src/lib/strings.ts` (`cs.taskPrice`)
- Modify: `src/routes/_app/ukol/$taskId.tsx`
- Test: `src/components/tasks/taskView.test.ts`, `src/components/tasks/scoreChangePanel.test.tsx`

**Interfaces:**
- Produces in `taskView.ts`:
  - `canProposeChange(task: Pick<TaskView, 'status' | 'reservedBy' | 'scoreChange'>, me: Me): boolean` — no open change; open → giver or taker; reserved → giver, or the reserving taker.
  - `changeAnswer(task, me): 'answer' | 'withdraw' | 'none'` — proposer → `withdraw`; in `waitingFor` → `answer`; else `none`.
- Strings `cs.taskPrice` (exact copy):
  - `change: 'Změnit cenu'`; hint under it: reserved → `needs: (name) => \`Stačí souhlas: ${name}\`` (the giver sees the taker's name, the taker sees `'rodič'`); open → `needsOpen: 'Platí, až souhlasí rodič i jeden z kluků'`
  - `drawerTitle: 'Změnit cenu'`, `drawerText: (score) => \`Nová cena platí, až ji potvrdí druhá strana. Do té doby zůstává ${score} b.\``, `send: (n) => \`Navrhnout ${n} b\``, `back: 'Zpět'`
  - `pending: 'Návrh nové ceny'`, `agree: 'Souhlasím'`, `disagree: 'Nesouhlasím'`, `withdraw: 'Stáhnout návrh'`, `oldStays: (n) => \`Dokud se nedomluvíte, platí ${n} b.\``
  - `toast: { proposed: 'Návrh odeslán', agreed: 'Cena změněna', declined: 'Návrh zamítnut', withdrawn: 'Návrh stažen' }`
  - `disagreeHint: (score) => \`Návrh se zavře, dál platí ${score} b.\``, `withdrawHint: (score) => \`Dál platí ${score} b.\``
  - `scoreChangeErrorMessage(error: string): string` in `src/lib/taskErrors.ts`, used by the price panel and the cancel dialog, falling back to `taskErrorMessage`: `not_involved` → 'Tohle rozhodují jiní.'; `change_pending` → 'O nové ceně se už jedná. Obnov stránku.'; `no_change` and `offer_changed` → 'Návrh už neplatí. Obnov stránku.'; `score_frozen` → 'Úkol je hotový, cenu už měnit nejde.'; `not_agreed` → 'Úkol se zase vyjednává. Obnov stránku.' (not the recurring-task text); `not_changeable` → `cs.tasks.errors.gone`.
- `ScoreChangePanel({ task, me })`:
  - open change: a tinted card (`bg-state-proposed/15`): "Návrh nové ceny", old score struck through → new score (Fredoka, `num`), "Souhlasí: Táta ✓", "Čeká se na: Starší nebo Mladší" (reuse `cs.bids.waitingFor`/`or`/`youAcc`), "Dokud se nedomluvíte, platí 18 b."; then per `changeAnswer`: two buttons "Nesouhlasím" (ghost) + "Souhlasím" (ok) side by side (`grid-cols-2`, labels never cut at 360 px) with the hint "Návrh se zavře, dál platí 18 b." under them, or one ghost "Stáhnout návrh" with "Dál platí 18 b.".
  - no change and `canProposeChange`: an action row button (full width, `min-h-tap`, pencil icon) "Změnit cenu" with the hint line; it opens a `Drawer` with `ScoreStepper` starting at the current score, the drawer text, primary "Navrhnout N b" (disabled while N equals the current score) and ghost "Zpět".
  - every call goes through `useTaskAction().run` (busy state on the tapped button, all disabled while busy, Czech error toast on refusal or network failure, `router.invalidate()` after).
- Route: render `<ScoreChangePanel>` after `TaskWorkPanel`; loader unchanged (detail already carries `scoreChange`).

- [ ] **Step 1: Failing tests:** `canProposeChange` table (giver/taker/other taker × open/reserved/proposed/done/cancelled × with/without change); `changeAnswer` for proposer/waiting/other; panel test: renders the pending card for Mladší with both buttons, tapping "Souhlasím" calls `approveTaskScoreChangeFn` with `{ taskId, changeId }` and not the decline one; tapping "Nesouhlasím" (as Mladší) calls `declineTaskScoreChangeFn` with `{ taskId, changeId }` and never the approve one; the proposer sees only "Stáhnout návrh", and tapping it calls `declineTaskScoreChangeFn`; `scoreChangeErrorMessage` table for the six codes above; drawer send disabled at the current score, enabled at +1 and sends `{ taskId, score: 19 }`.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `Task page: change the price`.

### Task 7: UI — cancel and history on the task page

**Files:**
- Create: `src/components/tasks/CancelTask.tsx`, `src/components/tasks/TaskHistory.tsx`, `src/components/tasks/historyText.ts`
- Modify: `src/lib/strings.ts` (`cs.cancelTask`, `cs.history`), `src/routes/_app/ukol/$taskId.tsx`
- Test: `src/components/tasks/historyText.test.ts`, `src/components/tasks/cancelTask.test.tsx`

**Interfaces:**
- `historyLine(entry: HistoryEntry, meId: number): string` (pure): `"<Prague weekday d. M. HH:MM> · <who>: <phrase>"`, who = `cs.bids.you`-style "ty" for me, name otherwise, omitted for null actor. Phrases (gender-neutral nouns), `n` = score:
  - created `nový úkol za n b` · score_countered `nabídka n b` · bid_placed `chce n b` · bid_accepted `přijato n b` · score_approved `souhlas s n b` · agreed `domluveno za n b` (+ ` · rezervace: <name>` when `reservedBy`) · reserved `rezervace` · released `uvolnění` · completed `hotovo` · approved `schváleno` · rejected `vráceno` · cancelled `zrušeno` · score_change_proposed `návrh nové ceny n b` · score_change_approved `souhlas s novou cenou n b` · score_change_declined `nesouhlas s novou cenou n b` · score_change_withdrawn `návrh ceny stažen` · score_changed `nová cena n b` · score_change_discarded `návrh ceny n b propadl` · any other task action `změna`.
  - reason, when set, follows on its own line: `„<reason>“`.
- `TaskHistory({ entries, meId })`: section label "Historie", a card with one line per entry (dot + text, `text-meta`, `break-words`, reasons wrap). Empty list → nothing rendered (a task always has `task.created`).
- `CancelTask({ task, me })`: shown only for a giver and status proposed/open/reserved. A full-width action row "Zrušit úkol" (red text, icon), hint "Zůstane v historii jako zrušený". Tap → `Dialog`: title "Zrušit úkol?", body "Úkol zmizí ze seznamů, ale zůstane v historii. Vrátit to nejde.", optional `Textarea` labelled "Důvod (uvidí ho všichni)" with `maxLength={REASON_MAX}`, buttons "Zrušit úkol" (no variant) and "Zpět" (ghost). Busy state on confirm; on success toast "Úkol zrušen", dialog closes, page invalidates (chip shows Zrušeno); on refusal the Czech error toast and the dialog stays open.
- Route order: state card, work panel, price panel, cancel, thread (when it has entries), history.

- [ ] **Step 1: Failing tests:** `historyLine` for each phrase above with a fixed `at` (`2026-11-21T09:12:00.000Z` → `so 21. 11. 10:12`, and summer `2026-07-04T09:12:00.000Z` → `so 4. 7. 11:12`), "ty" for me, the agreed + reservedBy form, reason line; cancel component: not rendered for a taker or a confirmed task; dialog confirm calls `cancelTaskFn` with `{ taskId, reason: 'Už to udělala máma.' }`, and with `reason: undefined` when blank.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `Task page: cancel and history`.

### Task 8: "Čeká na tebe" row and demo data

**Files:**
- Modify: `src/components/tasks/WaitingForYou.tsx` (new required prop `taskPriceChanges: readonly TaskView[]`), `src/routes/_app/index.tsx` (load `listScoreChangesWaitingFn` for giver and taker), `src/server/demo/seed.ts`
- Test: `src/components/tasks/homePage.test.tsx` (or `tasks.test.tsx` where WaitingForYou is tested), `src/server/demo/seed.test.ts`

**Interfaces:**
- WaitingForYou row: same shape as the template price-change row (#138): `negotiating` chip, the task name, meta `Nová cena: 18 → 20 b` (`cs.taskPrice.rowMeta(old, new)`), link button "Odpovědět" (`cs.bids.answer`) to `/ukol/$taskId`. Counted in the section total.
- Demo (`TASKMASTER_ENV=preview`): one open task "Vyluxovat celý obývák a chodbu" (score 10) with Táta's open proposal to 12 (waits for the brothers), and one cancelled task "Umýt okna v kuchyni" with reason "Udělá to firma.".
- [ ] **Step 1: Failing tests:** WaitingForYou renders the price-change row with the link for Starší; seed test finds the open change and the cancelled task with its audit reason.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `Domů and demo: task price changes`.

### Task 9: Verify

- [ ] `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build && pnpm db:check` all pass.
- [ ] **E2E** `e2e/task-page.spec.ts` (+ a project for it in `playwright.config.ts`, on the passkeys-off server like the existing off spec; `pnpm build` first), against the preview seed, logging in with the demo password: (a) Starší opens the seeded "Vyluxovat celý obývák a chodbu" from the "Čeká na tebe" row, taps Nesouhlasím → the page shows 10 b and no proposal; (b) Táta proposes 12 on it, Starší taps Souhlasím from the row → the page shows 12 b; (c) Táta cancels a seeded open task with reason "Udělá to firma." → chip Zrušeno, history shows "zrušeno" and the reason, and it is gone from Starší's Domů.
- [ ] Run the app with `TASKMASTER_ENV=preview`, Playwright at 360 px light theme: screenshots of the task page for Táta (open task with pending change; reserved task with "Změnit cenu" + "Zrušit úkol"; cancel dialog; cancelled task with history), Starší (pending change with Souhlasím / Nesouhlasím; Domů with the "Čeká na tebe" row), Mladší on a task reserved to Starší (no price buttons). Long Czech task name in each.
- [ ] Delete this plan file in its own commit, write the brief (skill `pr-brief`), mark ready, add label `preview`.
