# Admin dispute list and dismiss Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#47 Admin screen: settings and disputes](https://github.com/SlatinskyJ/taskmaster/issues/47), disputes half. The settings half shipped in PR #186. Correcting a dispute is [#48](https://github.com/SlatinskyJ/taskmaster/issues/48).

**Goal:** On Správa, the admin sees every open dispute (who, what, current value, reason) and can dismiss one with a note. The note reaches the family through the marks and the Rozporováno list that #46 already shows.

**Architecture:**
- The domain rule `dismissDispute` (src/domain/disputes.ts, merged in #110) already exists.
- `dismissDisputeIn` in `src/server/disputes/disputes.ts` loads the row, runs the rule, closes the row and writes `dispute.dismissed` in one transaction.
- `listOpenForAdmin` in `src/server/disputes/list.ts` returns the open disputes with their item's current value.
- Two admin-only server functions sit behind the `disputes` switch.
- A `DisputesCard` on Správa lists the disputes and opens a Dialog that takes the note.
- The demo seed swaps its hand-written dismissal for the real call.

**Tech Stack:** TanStack Start, Drizzle/better-sqlite3, React, shadcn Dialog, Vitest (renderToStaticMarkup), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §3 (admin settles disputes), §5.10 (audit), §5.11 (dismiss with a note; everyone involved sees the outcome); UI doc §7.5 (ADisputes).

**Size:** about 330 changed lines, not counting tests, so one PR. Breakdown:
- server ~110;
- functions ~50;
- card and dialog ~130;
- route, strings and seed ~40.

No schema change and no migration: migration 0023 already has `status`, `resolved_by`, `resolved_at` and `note`, plus a trigger that allows only open → closed.

## Global Constraints

- Czech UI text only in `src/lib/strings.ts`; code, identifiers and logs in English.
- Every state change writes its audit entry in the same transaction (`writeAudit`, `src/server/audit/`).
- Screens import server code only from `~/server/<module>/functions`.
- Dates are stored UTC with `toIsoUtc`. Prague display goes through `src/domain/dates.ts` helpers.
- Server functions answer `{ ok: false, error: 'feature_off' }`, or `{ error: 'feature_off' }` for reads, while `getFlags(db).disputes` is off.
- Admin only: `requireRole('admin')`. The domain rule checks `isActiveAdmin` again.
- Tap targets ≥ 44 px (`min-h-tap`), `motion-reduce:` on every animation, and a Czech busy state plus error message on every request.
- Jakub 2026-11-17: no design for deactivated users.

## Rulings in this plan (spec silent)

- **[ruling] Note length:** at most `DISPUTE_NOTE_MAX = 200` characters after trimming, the same as the reason. The DB only checks that the note is not empty. The parser enforces the maximum, and the dialog's `maxLength` matches it.
- **[ruling] Admin list scope:** open disputes only, oldest opened first (the admin works the queue in order). Closed ones stay visible to the family on Týden → Historie. The admin never needs them back, and the audit log keeps them.
- **[ruling] Current value:** the list shows the item's value now (`loadTarget(...).value`), not the value when it was opened. The two are the same until #48 adds corrections, and the admin decides on what stands now.
- **Correct button:** not in this PR. #48 adds "Opravit" beside "Nechat beze změny" on the same row.

## Review Focus

1. Two admin taps at once, or two admins: only one dismissal goes through. The second gets `not_open`, and only one audit entry is written.
2. A taker or giver calls `dismissDisputeFn` directly: refused by `requireRole('admin')`. The handler is also tested with a giver id and refuses with `not_admin`.
3. A note of only spaces, and a note of 200 vs 201 characters after trimming.
4. The switch off: the Správa section is hidden and both functions answer `feature_off`.
5. A long Czech task name and a long reason at 360 px: the row wraps and nothing is cut.

---

### Task 1: `dismissDisputeIn` on the server

**Files:**
- Modify: `src/server/disputes/disputes.ts`
- Modify: `src/lib/disputeLimits.ts` (add `DISPUTE_NOTE_MAX = 200`)
- Test: `src/server/disputes/disputes.test.ts`

**Interfaces:**
- Produces: `dismissDisputeIn(db: Db | Tx, adminId: number, disputeId: number, note: string, now: Date): Result<{ id: number }, DismissDisputeError>`, where `DismissDisputeError = DisputeError | 'not_found'`.
- Produces: `refOf(target: DisputeTarget): DisputeRef` (moved out of `openDisputeIn`, which now uses it).

- [ ] **Step 1: Write the failing tests.** Add a describe block `dismissDisputeIn (#47)`, on a test DB with one open dispute from `openDisputeIn`:
  - `the admin dismisses with a note: row closed, note trimmed, item unchanged`. Expect:
    - `status` is `'dismissed'`, `resolvedBy` is the admin, `resolvedAt` is `toIsoUtc(now)`, `note` is `'Sedí to.'` (from `'  Sedí to.  '`);
    - the task's score and status are unchanged;
    - `disputeMarks` gives `{ status: 'dismissed', note: 'Sedí to.' }`.
  - `writes dispute.dismissed with before open and after status and note`. The audit row has:
    - `action` `'dispute.dismissed'`, `entityType` `'dispute'`, `entityId` = the dispute id;
    - before `{ status: 'open' }`;
    - after `{ status: 'dismissed', note: 'Sedí to.' }`;
    - the actor is the admin.
  - `rolls back the dismissal when the audit write fails`. Use the same audit-failure helper as the `openDisputeIn` rollback test. Expect the row still open.
  - `refuses a giver and a taker: not_admin, row still open`.
  - `refuses a note of only spaces: note_required`.
  - `refuses a second dismissal: not_open, one audit entry`.
  - `refuses an unknown dispute id: not_found`.
  - `a new dispute can be opened on the item after a dismissal`. This pins that the partial unique index frees the item.
- [ ] **Step 2: Run them and watch them fail.** Run `pnpm test src/server/disputes/disputes.test.ts`. Expected: FAIL, `dismissDisputeIn` is not exported.
- [ ] **Step 3: Implement it.** Inside `db.transaction`:
  1. Select the row by id. If there is none, return `not_found`.
  2. Build the domain `Dispute` with `refOf(loadTarget(tx, item).target)`. If the target is gone, use `{ kind, id }` for a non-settlement; a settlement row is never deleted.
  3. Call `dismissDispute(dispute, listPeople(tx), adminId, note)`.
  4. Run `update ... where id = ? and status = 'open'`. If `changes !== 1`, return `not_open` (a race with the domain read).
  5. Call `writeAudit` as tested.
- [ ] **Step 4: Run the tests.** Same command. Expected: PASS, and the existing `openDisputeIn` tests still pass.
- [ ] **Step 5: Commit.** Message: `Dismiss a dispute on the server (#47)`.

### Task 2: the admin's open list

**Files:**
- Modify: `src/server/disputes/list.ts`
- Test: `src/server/disputes/disputes.test.ts` (describe `listOpenForAdmin`)

**Interfaces:**
- Produces: `listOpenForAdmin(db: Db | Tx): AdminDisputeEntry[]`.
- `AdminDisputeEntry` is `DisputeListEntry` without `mark` plus `value: DisputeValue | null`:

  ```ts
  { id; item; title; week; takerName; openedByName; reason; openedAt; value: DisputeValue | null }
  ```

  It reuses the `entry` builder; extract it so both lists use it.

- [ ] **Step 1: Write the failing tests:**
  - `lists every open dispute oldest first, with the item's value now`. Two open disputes and one dismissed: only the two open ones come back, in `openedAt` ascending order. A score shows `{ score }`; a settlement shows `{ level, deducted }`, `title ''` and its `week`.
  - `includes disputes a taker could not see`. A dispute Táta opened on Mladší's completion is in the admin list; the admin is not filtered.
- [ ] **Step 2: Run and watch it fail.** Expected: FAIL, the export is missing.
- [ ] **Step 3: Implement it.** Select `status = 'open'` ordered by `asc(openedAt), asc(id)`, with no viewer filter.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.** Message: `List open disputes for the admin (#47)`.

### Task 3: admin server functions

**Files:**
- Modify: `src/server/disputes/functions.ts`
- Test: `src/server/disputes/functions.test.ts`

**Interfaces:**
- Produces:
  - `parseDismissDispute(data: unknown): { id: number; note: string }`: exactly these keys; `note` is a string of at most `DISPUTE_NOTE_MAX` characters after trimming, else it throws `Invalid input`.
  - `dismissDisputeHandler(db, adminId, input, now)`, returning `{ ok: true } | { ok: false; error: DismissDisputeError | 'feature_off' }`.
  - `adminDisputesHandler(db)`, returning `AdminDisputeEntry[] | { error: 'feature_off' }`.
  - `dismissDisputeFn` (POST) and `getAdminDisputesFn` (GET), both `requireRole('admin')`.
  - Type re-exports: `AdminDisputeEntry`, `DisputeValue`.

- [ ] **Step 1: Write the failing tests:**
  - The parser accepts a note of 200 characters after trimming (padded with spaces) and throws on 201. It throws on an extra key, on an `id` of 0 or `'1'`, and on a non-string note.
  - Both handlers answer `feature_off` with the switch off and change nothing.
  - `dismissDisputeHandler` with a giver id returns `{ ok: false, error: 'not_admin' }`.
  - The `adminDisputesHandler` entry shape is pinned with `toEqual` on the exact keys: no user rows, no password fields.
  - `dismissDisputeFn` and `getAdminDisputesFn` are wired with `requireRole('admin')`. Use the existing guard test: the unguarded-server-function scan already covers new functions. Extend it if it lists roles.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement**, following the `openDisputeHandler` pattern.
- [ ] **Step 4: Run** `pnpm test src/server/disputes`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `Admin server functions for disputes (#47)`.

### Task 4: Rozpory on Správa

**Files:**
- Create: `src/components/admin/DisputesCard.tsx`
- Create: `src/components/admin/DismissDialog.tsx`
- Modify: `src/components/disputes/disputeProps.ts` (add `adminDisputeLines`)
- Modify: `src/routes/_app/sprava.tsx` (loader and section)
- Modify: `src/lib/strings.ts` (`cs.admin.disputes`)
- Test:
  - `src/components/admin/disputesCard.test.tsx`
  - `src/components/disputes/disputeProps.test.ts`
  - `src/components/admin/spravaPage.test.tsx`

**Interfaces:**
- Consumes: `getAdminDisputesFn` and `dismissDisputeFn` from Task 3.
- Produces: `adminDisputeLines(e: AdminDisputeEntry): { what: string; value: string; opened: string }`.
  - `what` is `cs.disputes.what[kind]`, plus ` · <takerName>` when there is one.
  - `value` is the title or `weekLabel` · `formatPoints(score)`, or for a settlement `cs.meeting.level[level]` · `cs.week.deducted` deducted. When `value` is null, only the title or week label.
  - `opened` is `cs.disputes.openedBy(openedByName, reason)` · the Prague date (`d. M.` through the existing date helper the Týden list uses).

Strings (`cs.admin.disputes`):
- `title: 'Rozpory'`
- `empty: 'Žádný otevřený rozpor.'`
- `keep: 'Nechat beze změny'`
- `keepFor: (what, name) => \`Nechat beze změny: ${what} – ${name}\``
- `noteLabel: 'Poznámka pro rodinu'`
- `noteHint: 'Uvidí ji ten, kdo rozporoval, a rodiče.'`
- `confirm: 'Nechat beze změny'`
- `saving: 'Ukládám…'`
- `done: 'Hotovo. Rodina uvidí poznámku.'`
- `loadError: 'Rozpory se nepodařilo načíst.'`
- `retry: 'Zkusit znovu'`
- errors: `not_open: 'Tenhle rozpor už je vyřízený.'`, `note_required: 'Napiš poznámku.'`, `not_found: 'Tenhle rozpor už neexistuje.'`; `feature_off` and `generic` come from `cs.disputes.errors`.

- [ ] **Step 1: Write the failing tests:**
  - `adminDisputeLines` gives the exact strings for:
    - a task score: `'Body za úkol'`, `'Vyluxovat celý obývák a chodbu · 30 bodů'`;
    - a completion with a taker: `'Potvrzené splnění · Starší'`;
    - a settlement: `'Vyúčtování týdne · Mladší'`, `'<week label> · Spodní hranice · Odečteno 50'`, taking the deducted label from `cs.week`.
  - `DisputesCard`:
    - shows one row per entry, with the three lines and a `Nechat beze změny` button of `min-h-tap` whose accessible name is `keepFor(what, title or week)`;
    - shows the `empty` line with no entries;
    - with `error`, shows `loadError` and a `retry` button.
  - `DismissDialog`:
    - the confirm button is disabled while the note is only spaces;
    - the textarea has `maxLength={200}` and the label `noteLabel`;
    - the busy state shows `saving`;
    - an error string renders in `role="alert"`.
  - Správa page:
    - with entries, it renders `Rozpory` above `Výchozí týden`;
    - with a `feature_off` loader result, it has no `Rozpory` section.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement:**
  - The loader adds `getAdminDisputesFn()`, caught: a thrown fetch becomes `{ error: 'load' }`, so the card shows the retry, which calls `router.invalidate()`.
  - The Dialog is the confirm step for this irreversible action: its text says the dispute closes and the note is shown to the family.
  - On success: toast `done`, close, `router.invalidate()`.
  - On error: the Czech message stays inside the dialog, and the note is kept.
  - Rows wrap (`break-words`, `min-w-0`) and nothing is truncated.
  - The Dialog's animation already has `motion-reduce:` from `ui/dialog.tsx`; check that, and add it if it is missing.
- [ ] **Step 4: Run** `pnpm test src/components src/routes`, then `pnpm lint` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `Rozpory on Správa: keep a dispute with a note (#47)`.

### Task 5: seed and e2e

**Files:**
- Modify: `src/server/demo/pieces.ts` (the `disputes` piece)
- Modify: `e2e/disputes.spec.ts`
- Test: `src/server/demo/demo.test.ts` (existing assertions must still pass)

- [ ] **Step 1: Seed.** Replace the hand-written `update` and `writeAudit` with `step('keep Mladší's settlement', dismissDisputeIn(tx, id('admin'), opened.id, DISMISS_NOTE, now))`, and update the piece's comment. Run `pnpm test src/server/demo`. Expected: PASS, with the same marks as before.
- [ ] **Step 2: e2e test** `admin keeps Starší's "Vysát auto" dispute; Starší reads the note`, appended to the serial suite:
  1. The admin logs in and opens `/sprava`.
  2. The `Rozpory` section lists `Vysát auto` with Starší's reason.
  3. Tap `keepFor(...)`; the confirm button is disabled until a note is typed.
  4. Fill `Vysával jen kabinu, body sedí.` and confirm.
  5. The toast `done` shows and the row is gone.
  6. Starší logs in and opens `/tyden`. The `Vysát auto` row contains `cs.disputes.kept('Vysával jen kabinu, body sedí.')`.
- [ ] **Step 3: Run** `pnpm build && pnpm exec playwright test e2e/disputes.spec.ts --trace off`. Expected: PASS.
- [ ] **Step 4: Commit.** Message: `Seed and e2e use the admin's dismiss (#47)`.
