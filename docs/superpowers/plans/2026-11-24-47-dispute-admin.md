# Admin dispute list and dismiss Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#47 Admin screen: settings and disputes](https://github.com/SlatinskyJ/taskmaster/issues/47), disputes half. The settings half shipped in PR #186. Correcting a dispute is [#48](https://github.com/SlatinskyJ/taskmaster/issues/48).

**Goal:** On Správa, the admin sees every open dispute (who, what, current value, reason) and can dismiss one with a note. The note reaches the family through the marks and the Rozporováno list that #46 already shows.

**Architecture:**
- The domain rule `dismissDispute` (src/domain/disputes.ts, merged in #110) already exists.
- `dismissDisputeIn` in `src/server/disputes/disputes.ts` loads the row, runs the rule, closes the row and writes `dispute.dismissed` in one transaction.
- `listOpenForAdmin` in `src/server/disputes/list.ts` returns the open disputes with their item's current value.
- Two admin-only server functions sit behind the `disputes` switch.
- A `DisputesCard` ("Sporné") on Správa lists the disputes and opens a Dialog that takes the note.
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
- **[ruling] Current value:** the list shows the item's value now (`loadTarget(...).value`), not the value when it was opened. They can differ today: an agreed score can change through a score change (#105, #138). So the admin decides on what stands now, and the dismiss call carries the value he saw. If it changed since he loaded Správa, the server refuses with `value_changed` and the list reloads. The `dispute.dismissed` entry records the kept value.
- **Correct button:** not in this PR. #48 adds "Opravit" beside "Ponechat" on the same row. Both labels are short, so they fit side by side at 360 px.

## Review Focus

1. The value changed between loading Správa and tapping Ponechat (a score change agreed meanwhile): refused, nothing written.
2. Two admin taps at once, or two admins: only one dismissal goes through. The second gets `not_open`, and only one audit entry is written.
3. A taker or giver calls `dismissDisputeFn` directly: refused by `requireRole('admin')`. The handler is also tested with a giver id and refuses with `not_admin`.
4. A note of only spaces, and a note of 200 vs 201 characters after trimming.
5. The switch off: the Správa section is hidden and both functions answer `feature_off`.
6. A long Czech task name and a long reason at 360 px: the row wraps and nothing is cut.

---

### Task 1: `dismissDisputeIn` on the server

**Files:**
- Modify: `src/server/disputes/disputes.ts`
- Modify: `src/lib/disputeLimits.ts` (add `DISPUTE_NOTE_MAX = 200`)
- Test: `src/server/disputes/disputes.test.ts`

**Interfaces:**
- Produces: `dismissDisputeIn(db: Db | Tx, adminId: number, disputeId: number, seen: DisputeValue | null, note: string, now: Date): Result<{ id: number }, DisputeServerError>`.
  - `seen` is the value the admin's list showed.
  - `OpenDisputeError` is renamed `DisputeServerError = DisputeError | 'not_found' | 'value_changed'`, one union for open, dismiss and #48's correct; `openDisputeIn` keeps returning a subset of it.
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
    - the actor is the admin;
    - the after payload also holds `value` (the kept value, e.g. `{ score: 30 }`).
  - `rolls back the dismissal when the audit write fails`. Use the same audit-failure helper as the `openDisputeIn` rollback test. Expect the row still open.
  - `refuses a giver and a taker: not_admin, row still open, no dispute.dismissed entry`.
  - `refuses a note of only spaces: note_required, no dispute.dismissed entry`.
  - `refuses null as seen on a scored item: value_changed`. This pins that the check isn't written as `if (seen && …)`.
  - `refuses when the value changed since the admin saw it: value_changed`. Open a dispute on a task score of 30, change the score to 40 directly in the test DB, then dismiss with `seen = { score: 30 }`. Expect `value_changed`, the row still open and no audit entry. The same call with `{ score: 40 }` succeeds.
  - `refuses a second dismissal: not_open, one audit entry`.
  - `refuses an unknown dispute id: not_found`.
  - `a new dispute can be opened on the item after a dismissal`. This pins that the partial unique index frees the item.
- [ ] **Step 2: Run them and watch them fail.** Run `pnpm test src/server/disputes/disputes.test.ts`. Expected: FAIL, `dismissDisputeIn` is not exported.
- [ ] **Step 3: Implement it.** Inside `db.transaction`:
  1. Select the row by id. If there is none, return `not_found`.
  2. Build the domain `Dispute` with `refOf(loadTarget(tx, item).target)`. If the target is gone, use `{ kind, id }` for a non-settlement; a settlement row is never deleted.
  3. Compare `seen` with `loadTarget(...).value` (deep equal, or both null). If they differ, return `value_changed`. Then call `dismissDispute(dispute, listPeople(tx), adminId, note)`.
  4. Run `update ... where id = ? and status = 'open'`. If `changes !== 1`, return `not_open` (a race with the domain read).
  5. Call `writeAudit` as tested.
  6. Update the stale comments: "Closing … comes later" in `disputes.ts`, the header of `list.ts`, and `src/server/disputes/README.md` (add `dismissDisputeIn` and `listOpenForAdmin`).
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
  - `includes disputes no taker but their own could see`. A dispute Starší opened on his own completion is in the admin list, and `listDisputes` for Mladší does not have it. The admin's list is not filtered.
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
  - `parseDismissDispute(data: unknown): { id: number; value: DisputeValue | null; note: string }`: exactly these keys. `note` is a string of at most `DISPUTE_NOTE_MAX` characters after trimming. `value` is null, `{ score: int }` or `{ level: 'none'|'lower'|'upper', deducted: int ≥ 0 }` with exactly those keys. Anything else throws `Invalid input`.
  - `dismissDisputeHandler(db, adminId, input, now)`, returning `{ ok: true } | { ok: false; error: DisputeServerError | 'feature_off' }`.
  - `adminDisputesHandler(db)`, returning `AdminDisputeEntry[] | { error: 'feature_off' }`.
  - `dismissDisputeFn` (POST) and `getAdminDisputesFn` (GET), both `requireRole('admin')`.
  - Type re-exports: `AdminDisputeEntry`, `DisputeValue`.

- [ ] **Step 1: Write the failing tests:**
  - The parser accepts a note of 200 characters after trimming (padded with spaces) and throws on 201. It throws on an extra key, on an `id` of 0 or `'1'`, on a non-string note, on `value: { score: '3' }` and on `value: { level: 'top', deducted: 1 }`.
  - Both handlers answer `feature_off` with the switch off and change nothing.
  - `dismissDisputeHandler` with a giver id returns `{ ok: false, error: 'not_admin' }`.
  - `dismissDisputeHandler` with a stale `value` returns `value_changed`. This pins that the handler passes `input.value` through.
  - `DisputesCard` sends the row's `value` in the dismiss call: pin the argument the card passes to its `onKeep` callback.
  - The `adminDisputesHandler` entry shape is pinned with `toEqual` on the exact keys: no user rows, no password fields.
  - `tests/server-fn-guards.test.ts`: add `dismissDisputeFn: 'admin'` and `getAdminDisputesFn: 'admin'` to `EXPECTED_ROLES`. That file pins the exact roles, so wiring either function to any other role list fails it.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement**, following the `openDisputeHandler` pattern.
- [ ] **Step 4: Run** `pnpm test src/server/disputes`. Expected: PASS.
- [ ] **Step 5: Commit.** Message: `Admin server functions for disputes (#47)`.

### Task 4: Sporné on Správa

**Files:**
- Create: `src/components/admin/DisputesCard.tsx`
- Create: `src/components/admin/DismissDialog.tsx`
- Modify: `src/components/disputes/disputeProps.ts` (add `adminDisputeLines`)
- Modify: `src/lib/disputeErrors.ts` (add `adminDisputeErrorMessage`)
- Modify: `src/components/disputes/disputeCalls.ts` (add `sendDismiss`, same shape as `sendDispute`; #48's correct dialog reuses the pattern)
- Modify: `src/routes/_app/sprava.tsx` (loader and section)
- Modify: `src/lib/strings.ts` (`cs.admin.disputes`)
- Test:
  - `src/components/admin/disputesCard.test.tsx`
  - `src/components/disputes/disputeProps.test.ts`
  - `src/components/admin/spravaPage.test.tsx`

**Interfaces:**
- Consumes: `getAdminDisputesFn` and `dismissDisputeFn` from Task 3.
- Produces: `adminDisputeLines(e: AdminDisputeEntry): { what: string; value: string; opened: string; reason: string }`.
  - `what` is `cs.disputes.what[kind]`, plus ` · <takerName>` when there is one.
  - `value` is the title or `weekLabel` · `formatPoints(score)`, or for a settlement `cs.meeting.level[level]` · `${cs.week.deducted} ${deducted}` (lowercase `odečteno`). When `value` is null, only the title or week label.
  - `opened` is `openedByName` · the Prague date (`d. M.` through the existing Prague date helper in `src/domain/dates.ts`).
  - `reason` is the reason as is; the row shows it in its own quote block (UI doc §7.5 ADisputes), so a long reason never runs into the date.

Strings (`cs.admin.disputes`):
- `title: (n: number) => \`Sporné (${n})\`` (the open count; the word matches `cs.state.disputed` and the mockup)
- `empty: 'Žádný otevřený rozpor.'`
- `keep: 'Ponechat'` (short: shares a row with #48's `Opravit` at 360 px)
- `keepFor: (what, name) => \`Ponechat: ${what} – ${name}\``
- `dialogTitle: 'Ponechat beze změny'`
- `dialogText: 'Rozpor se uzavře, body ani stav se nezmění. Vzít zpět to nejde.'`
- `noteLabel: 'Poznámka pro rodinu'`
- `noteHint: 'Uvidí ji rodiče i děti, kterých se to týká.'` (true to `visibleTo`: the opener, the item's boy, givers, and everyone for a score)
- `confirm: 'Ponechat'`; cancel is `cs.admin.cancel`
- `saving: 'Ukládám…'`
- `done: 'Hotovo. Rodina uvidí poznámku.'`
- `loadError: 'Sporné se nepodařilo načíst.'`
- `retry: 'Zkusit znovu'`
- errors: `not_open: 'Tenhle rozpor už je vyřízený.'`, `value_changed: 'Mezitím se to změnilo. Podívej se znovu.'` (handled outside the dialog, see Step 3), `note_required: 'Napiš poznámku.'`, `not_found: 'Tenhle rozpor už neexistuje.'`; `feature_off` and `generic` come from `cs.disputes.errors`.

- [ ] **Step 1: Write the failing tests:**
  - `adminDisputeLines` gives the exact strings for:
    - a task score: `'Body za úkol'`, `'Vyluxovat celý obývák a chodbu · 30 bodů'`;
    - a completion with a taker: `'Potvrzené splnění · Starší'`;
    - a settlement: `'Vyúčtování týdne · Mladší'`, `'<week label> · Spodní hranice · odečteno 50'`;
    - `opened` for `openedAt` `'2026-11-22T23:30:00.000Z'` is `'Starší · 23. 11.'` (Prague date, not the UTC 22.).
  - `DisputesCard`:
    - the title is `Sporné (2)` for two entries;
    - each row has the disputed stripe (`border-l-4 border-l-state-disputed`, as in `DisputeList`);
    - shows one row per entry, with the lines, the reason in its own block and a `Ponechat` button of `min-h-tap` whose accessible name is `keepFor(what, title or week)`;
    - shows the `empty` line with no entries;
    - with `error`, shows `loadError` and a `retry` button.
  - `DismissDialog`:
    - the confirm button is disabled while the note is only spaces;
    - the textarea has `maxLength={200}` and the label `noteLabel`;
    - the busy state shows `saving`;
    - an error string renders in `role="alert"`.
  - `sendDismiss` returns `{ ok: true } | { ok: false; message: string; reload: boolean }`. `reload` is true for `value_changed`, `not_open` and `not_found`. Test each of those three, plus `note_required` (`reload: false`). A refused call gives the Czech text, a thrown call gives `generic`, an ok call gives null. The dialog test with an `error` prop keeps the typed note in the textarea.
  - `adminDisputeErrorMessage` maps each code above and `feature_off`, and anything else gives `generic`.
  - Správa page:
    - with entries, it renders `Sporné (n)` above `Výchozí týden`;
    - with a `feature_off` loader result, it has no `Sporné` section;
    - with a `{ error: 'load' }` loader result, it shows `loadError` and the retry button.
  - Export the loader's disputes step as `loadAdminDisputes(call)` from `src/components/admin/DisputesCard.tsx` so it is unit-tested: a throwing `call` gives `{ error: 'load' }`, and `feature_off` passes through.
- [ ] **Step 2: Run and watch them fail.**
- [ ] **Step 3: Implement:**
  - The loader adds `getAdminDisputesFn()`, caught: a thrown fetch becomes `{ error: 'load' }`, so the card shows the retry, which calls `router.invalidate()`.
  - The Dialog is the confirm step for this irreversible action: its text says the dispute closes and the note is shown to the family.
  - On success: toast `done`, close, `router.invalidate()`.
  - On `value_changed`, `not_open` or `not_found`: the dialog closes, the Czech message shows as an error toast, and `router.invalidate()` reloads the list. The row then shows the new value or is gone, so a retry never resends the stale value.
  - On any other error (`note_required`, `feature_off`, generic): the Czech message stays inside the dialog and the note is kept.
  - Rows wrap (`break-words`, `min-w-0`) and nothing is truncated.
  - The Dialog's animation already has `motion-reduce:` from `ui/dialog.tsx`; check that, and add it if it is missing.
- [ ] **Step 4: Run** `pnpm test src/components src/routes`, then `pnpm lint` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Screenshots for the UX judge** at 360×800, light, into `<scratch>/shots213/`:
  - a score row with a ~30-letter task name and a 200-character reason;
  - a settlement row;
  - the empty state;
  - the error state with retry;
  - the dialog with an error, and with the keyboard up (viewport 360×450);
  - the error toast after `value_changed`, with the reloaded row.
- [ ] **Step 6: Commit.** Message: `Sporné on Správa: keep a dispute with a note (#47)`.

### Task 5: seed and e2e

**Files:**
- Modify: `src/server/demo/pieces.ts` (the `disputes` piece)
- Modify: `e2e/disputes.spec.ts`
- Test: `src/server/demo/demo.test.ts` (existing assertions must still pass)

- [ ] **Step 1: Seed.** Replace the hand-written `update` and `writeAudit` with `step('keep Mladší's settlement', dismissDisputeIn(tx, id('admin'), opened.id, loadTarget(tx, { kind: 'settlement', id: record.id })?.value ?? null, DISMISS_NOTE, now))`, and update the piece's comment. Run `pnpm test src/server/demo`. Expected: PASS, with the same marks as before.
- [ ] **Step 2: e2e test** `admin keeps Starší's "Vysát auto" dispute; Starší reads the note`, appended to the serial suite:
  1. The admin logs in and opens `/sprava`.
  2. The `Sporné` section lists `Vysát auto` with Starší's reason.
  3. Tap `keepFor(...)`; the confirm button is disabled until a note is typed.
  4. Fill `Vysával jen kabinu, body sedí.` and confirm.
  5. The toast `done` shows and the row is gone.
  6. Starší logs in and opens `/tyden`. The `Vysát auto` row contains `cs.disputes.kept('Vysával jen kabinu, body sedí.')`.
- [ ] **Step 3: Run** `pnpm build && pnpm exec playwright test e2e/disputes.spec.ts --trace off`. Expected: PASS.
- [ ] **Step 4: Commit.** Message: `Seed and e2e use the admin's dismiss (#47)`.
