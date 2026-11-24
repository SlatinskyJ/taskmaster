# Approve done work from the task page and Úkoly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (CLAUDE.md PR flow step 3). Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#206 Approve done work from the task page and Úkoly](https://github.com/SlatinskyJ/taskmaster/issues/206)

**Goal:** A parent can approve (✓ Schválit) or reject (✕ Zamítnout, optional reason) a done, unconfirmed task from its task page and from Úkoly → Čeká na potvrzení, and Ke schválení moves to the top of the parent's Domů whenever something waits.

**Architecture:** UI only. The server functions `approveTaskFn` / `rejectTaskFn` (spec §5.5) already exist and already refuse a taker and a task that is not `done_unconfirmed`; nothing on the server changes. The ✓/✕ buttons and the reason form now living inside `ToApprove.tsx` move into one shared module, used by Domů, Úkoly and the task page. Everything new sits behind a new launch switch `approveAnywhere` (off in prod, on in `demo` and in the suites that test it).

**Tech Stack:** TanStack Start (React, TS), Tailwind v4 + shadcn/ui, vitest (static render), Playwright e2e, Drizzle (one data-only migration).

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.5 (a giver confirms or rejects a completion; reject goes back to the taker's reservation or to open). No rule changes.

**Size:** about 200 changed lines outside tests (new module ~120, moved out of `ToApprove.tsx` ~90 removed there, routes ~40, switch + migration ~15).

## Global Constraints

- Czech UI text only in `src/lib/strings.ts`; reuse `cs.work.approve` ("Schválit"), `cs.work.reject` ("Zamítnout"), `cs.work.rejectReason` ("Proč? (nepovinné)"), `cs.work.back` ("Zpět"), `cs.work.toast.approved` / `.rejected`. No new strings expected.
- Reason max `REASON_MAX` (`src/lib/taskLimits.ts`), trimmed, blank = none (server already does this).
- Tap targets ≥ 44 px (`size-tap` icon buttons, `min-h-tap` buttons). Animations keep `motion-reduce:`.
- Keyboard rule (CLAUDE.md): the reason field stays visible while typing, on every screen it appears; a case in an e2e keyboard spec.
- Launch switch per `src/server/features/README.md`: key in `FEATURE_KEYS`, row seeded off in a new migration, `demo` turns it on via `FEATURE_KEYS`.
- Never edit a committed migration.

## Review Focus

1. A brother (taker) opens a done, unconfirmed task page: sees no ✓/✕ (only a giver may approve). Test in Task 3.
2. Switch off (prod today): task page, Úkoly and Domů look exactly as now (Ke schválení under the points, no ✓/✕ on Úkoly). Tests in Tasks 3–5.
3. Long Czech task name (~30 letters, "Vyluxovat celý obývák a chodbu") on an Úkoly Čeká na potvrzení row with two 44 px icon buttons at 360 px: the name wraps to two lines, is not cut to "…" on one line; chip, points and "Udělal …" stay whole. Screenshot in Task 6; layout reuses the existing `TaskRow` + icon buttons as on Domů (#131).
4. A rejection or approval fails (network / refused): the row keeps its buttons, `useTaskAction` shows its Czech error toast, the form stays open with the reason typed so the person can retry. Test in Task 2.
5. (e2e step 3) After ✓ on the task page the page reloads to Hotovo state and the ✓/✕ disappear (no second click possible); after ✕ the task shows its reservation/open state. e2e in Task 6.

---

### Task 1: The `approveAnywhere` switch

**Files:**
- Modify: `src/lib/features.ts` (add `'approveAnywhere'` after `'disputes'` with a doc comment "Approve done work from the task page and Úkoly; Ke schválení first on a parent's Domů (#206)"; add to `NO_FEATURES` false, `ALL_FEATURES` true)
- Create: `drizzle/0027_approve_anywhere_switch.sql` (number: the next free one when built; if [#227](https://github.com/SlatinskyJ/taskmaster/pull/227) merges first with its own 0027, delete this migration + journal entry and run `db:generate` again, never hand-merge `_journal.json`) via `pnpm db:generate --custom --name approve_anywhere_switch`, body like 0024: `INSERT INTO \`feature_flags\` (\`key\`, \`enabled\`) VALUES ('approveAnywhere', 0);` with a comment line naming #206.
- Modify: `src/server/features/README.md` (one sentence: 0027 adds `approveAnywhere`, off)
- Modify: `src/server/demo/seeds.ts` (new seed `approve: { pieces: [negotiation, points], features: ['approveAnywhere'] }`, doc comment "#206: done work to approve on Úkoly and the task page")
- Test: `src/server/features/flags.test.ts`, `src/server/demo/suites.test.ts` (new case: `approve` seed has the same tasks as `home` and switch `approveAnywhere` on, every other off)

**Interfaces:** Produces `features.approveAnywhere: boolean` in route context.

- [ ] Step 1: update `flags.test.ts` first test to expect `approveAnywhere: false` (name: "...disputes and approveAnywhere off (0024, 0027)"), the hand-off test to `{ ...ALL_FEATURES, recurring: false, disputes: false, approveAnywhere: false }`, the no-row test to `approveAnywhere: true`. Run `pnpm test src/server/features` → FAIL.
- [ ] Step 2: add key, migration, README line. `pnpm test src/server/features` → PASS. `pnpm db:check` → OK.
- [ ] Step 3: add the seed (suite rows come in Task 6: `tests/e2e-suites.test.ts` requires each row's spec file to exist). `pnpm test src/server/demo` → PASS.
- [ ] Step 4: commit "Add the approveAnywhere launch switch".

### Task 2: Shared approve controls

**Files:**
- Create: `src/components/tasks/ApproveControls.tsx`
- Modify: `src/components/tasks/ToApprove.tsx` (map items to `ApprovableRow`; keeps section label + count, renders nothing when empty). Blast radius: `ToApprove` is also on Schůzka (`src/components/meeting/MeetingScreen.tsx:161`); its markup there must not change (existing `meeting.test.tsx` stays green unchanged; the brief names Schůzka).
- Modify: `src/components/tasks/taskView.ts` (add `canApprove`)
- Test: `src/components/tasks/approveControls.test.tsx` (new), `src/components/tasks/taskView.test.ts`, existing `tasks.test.tsx` / `homePage.test.tsx` stay green unchanged

**Interfaces (produces):**
- `canApprove(task: Pick<TaskView, 'status'>, me: Me): boolean` — `me.role === 'giver' && task.status === 'done_unconfirmed'`.
- `submitReject(taskId: number, reason: string, run: Run, onClose: () => void): Promise<void>` — the submit logic as a plain function (testable without a DOM): trims, sends `reason: trimmed || undefined`, awaits `run`, calls `onClose()` only when it resolved `true`.
- `RejectForm({ taskId, busy, run, onClose }: { taskId: number; busy: string | null; run: Run; onClose: () => void })` — the current form from `ToApprove` (label + `Input` `name="reason"` `autoFocus` `enterKeyHint="send"` `maxLength={REASON_MAX}`, Zpět ghost, Zamítnout `variant="no"` submit); on submit `run('reject-<id>', rejectTaskFn({ taskId, reason: trimmed || undefined }), () => cs.work.toast.rejected)` and calls `onClose()` only when it resolves `true`. Zpět calls `onClose()`.
- `ApprovableRow({ task, busy, run }: { task: TaskView; busy: string | null; run: Run })` — `TaskRow` (state `pending`, points, meta `Udělal <name>`) with icon ✕ (`size="icon"`, `aria-label` Zamítnout) and ✓ (`variant="ok"`, `aria-label` Schválit, confetti + float as now); ✕ swaps the buttons for `RejectForm` below the row; Zpět returns focus to that row's ✕ (as now, `requestAnimationFrame`).
- `ApprovePanel({ task, me }: { task: TaskView; me: Me })` — task page: `null` unless `canApprove`; own `useTaskAction()`; `grid gap-2`: Schválit (`variant="ok"`, `w-full`, confetti + float), Zamítnout (`variant="no"`, `w-full`) which swaps both for `RejectForm`; Zpět returns focus to Zamítnout.
- `Run` type from `./WorkButtons`.

- [ ] Step 1: tests (static render with `useTaskAction` mocked like `taskPage.test.tsx`; for the interactive bits use the same harness `tasks.test.tsx` uses for ToApprove today):
  - `canApprove`: giver + done_unconfirmed → true; taker + done_unconfirmed → false; giver + reserved/open/confirmed → false.
  - `ApprovableRow` renders name, "Udělal Starší", buttons labelled Schválit and Zamítnout, no reason field.
  - `ApprovePanel` for a giver on done_unconfirmed: two full-width buttons Schválit, Zamítnout; for a taker → empty markup; for a giver on `reserved` → empty markup.
  - `submitReject`: with "  " sends `rejectTaskFn({ data: { taskId: 7, reason: undefined } })`; with " špatně " sends `reason: 'špatně'`; `run` resolving `false` → `onClose` not called (the form, and the typed text in its state, stay); resolving `true` → called once.
  - `ApprovePanel`: pressing Schválit (through the Button-recording mock `tasks.test.tsx` uses) calls `run` whose call sends `approveTaskFn({ data: { taskId: 7 } })` (assert on the mocked `approveTaskFn`), never `rejectTaskFn`. Same for `ApprovableRow`'s ✓.
- [ ] Step 2: run `pnpm test src/components/tasks` → new tests FAIL.
- [ ] Step 3: implement `ApproveControls.tsx`, `canApprove`, rewire `ToApprove` (its existing tests unchanged must pass: same markup on Domů).
- [ ] Step 4: `pnpm test src/components/tasks` → PASS. Commit "Share the approve and reject controls".

### Task 3: ✓/✕ on the task page

**Files:**
- Modify: `src/routes/_app/ukol/$taskId.tsx` (render `{features.approveAnywhere && <ApprovePanel task={task} me={me} />}` right after the state card, before `TaskWorkPanel`)
- Test: `src/components/tasks/taskPage.test.tsx` (mock context gains `approveAnywhere`)

- [ ] Step 1: tests: giver + done_unconfirmed + switch on → Schválit and Zamítnout present; switch off → absent; taker (the one who did it) + switch on → absent.
- [ ] Step 2: FAIL → implement → PASS. Commit "Approve from the task page".

### Task 4: ✓/✕ on Úkoly → Čeká na potvrzení

**Files:**
- Modify: `src/components/tasks/TaskGroups.tsx` (new optional prop `approve?: { busy: string | null; run: Run }`; when set and `t.status === 'done_unconfirmed'`, the `li` renders `<ApprovableRow task={t} {...approve} />` instead of the plain `TaskRow`. Doc comment on the prop: the whole row is swapped because the reason form sits under the row, outside `TaskRow`; the approvable row's meta is "Udělal <name>", which is what the page's `meta` returns for that state anyway, and a done task has no `lowest` detail)
- Modify: `src/routes/_app/ukoly/index.tsx` (pass `approve={features.approveAnywhere ? { busy, run } : undefined}`; the shared `busy` keeps one action at a time across the page)
- Test: `src/components/tasks/ukolyPage.test.tsx`

- [ ] Step 1: tests: switch on → a done_unconfirmed row has Schválit + Zamítnout, a reserved row still has Uvolnit, an open row still has Hotovo bez bodů; switch off → done_unconfirmed row has no Schválit.
- [ ] Step 2: FAIL → implement → PASS. Commit "Approve from Úkoly".

### Task 5: Ke schválení first on a parent's Domů

**Files:**
- Modify: `src/components/home/GiverHome.tsx` (new prop `approveOnTop: boolean`; when true it does not render `ToApprove`)
- Modify: `src/routes/_app/index.tsx` (for a giver with `features.approveAnywhere`, render `<ToApprove items={toApprove} />` as the first child of `Screen`, above `WaitingForYou`; pass `approveOnTop={features.approveAnywhere}`)
- Test: `src/components/tasks/homePage.test.tsx`

- [ ] Step 1: tests: existing order test stays as is for switch off. New: switch on, parent with items → order Ke schválení, Čeká na tebe, Kluci tento týden, Vyjednávání, Čeká na kluky, and `Ke schválení` appears exactly once; switch on, nothing to approve → no Ke schválení label at all; a brother with the switch on → no Ke schválení.
- [ ] Step 2: FAIL → implement → PASS. Commit "Put Ke schválení first on a parent's Domů".

### Task 6: e2e + keyboard

**Files:**
- Modify: `e2e/suites.ts`: rows `{ name: 'approve', spec: 'approve.spec.ts', seed: 'approve' }` (comment "Its own server: it approves and rejects for good.") and `{ name: 'keyboard-approve', spec: 'keyboard-approve.spec.ts', seed: 'approve' }` (comment "Read-only: forms are opened, never sent.").
- Create: `e2e/approve.spec.ts` (seed `approve`, serial):
  1. `tata` Domů: the first section label in `main` is `Ke schválení (1)`.
  2. `starsi` on Domů presses Hotovo on his reserved "Vyluxovat celý obývák a chodbu" (now done_unconfirmed, a second item); on its task page he sees no Schválit / Zamítnout.
  3. `tata` opens the task page of "Vytřít podlahu v kuchyni" (by URL: rows link to their page only with [#205](https://github.com/SlatinskyJ/taskmaster/issues/205), the next PR) → Schválit → the page shows the Hotovo chip and no Schválit / Zamítnout; Úkoly lists it under Hotovo, Čeká na potvrzení (1).
  3b. `tata` Úkoly → Čeká na potvrzení row ✕ → Zpět (form closes, nothing sent).
  4. `tata` opens "Vyluxovat celý obývák a chodbu" → Zamítnout → types "Ještě chodba" → Zamítnout → page shows the Rezervováno chip (it was reserved, spec §5.5), no Schválit, and the history shows "Ještě chodba".
- Create: `e2e/keyboard-approve.spec.ts` (pattern of `keyboard-fix.spec.ts`, read-only, `tata`): Úkoly row "Vytřít podlahu v kuchyni" ✕ → reason field `openKeyboard` + `expectAboveKeyboard`; its task page → Zamítnout → same.
- Screenshots (outside repo, 360×800 light, per `pr-review-rounds`), taken after step 2 of the flow above so the long name "Vyluxovat celý obývák a chodbu" is in Čeká na potvrzení: `domu-tata-approve-top.png`, `ukoly-tata-pending-long.png`, `ukoly-tata-reject-form.png`, `ukol-tata-approve.png`, `ukol-tata-reject-form.png`, `ukol-starsi-pending.png`, `ukol-tata-keyboard-reason.png`, `ukoly-tata-keyboard-reason.png`.

- [ ] Step 1: write both specs + rows; `pnpm e2e --project approve --project keyboard-approve` → PASS; `pnpm test tests` → PASS.
- [ ] Step 2: full gate: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build && pnpm db:check` → all green. Commit "e2e: approve from the task page and Úkoly".
