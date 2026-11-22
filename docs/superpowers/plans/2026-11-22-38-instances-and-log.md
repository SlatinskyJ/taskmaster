# Instances on demand and self-logged chores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#38 Instances on demand and self-logged chores](https://github.com/SlatinskyJ/taskmaster/issues/38)

**Goal:** A giver taps "+ Teď" on an agreed template to make an open instance of it; a taker logs a chore he did unprompted on Zapsat, which arrives done, unconfirmed and always waits for a giver.

**Architecture:** An instance is a row in the existing `tasks` table with `template_id` and `origin` set, so reserve / release / Hotovo / approve / reject / cancel, the points bar, the meeting's pending list, Týden and the task page all work on instances unchanged. The domain already models instances (`createInstance`, `selfLog`, `rejectCompletion` → `rejected` in `src/domain/lifecycle.ts`); this PR adds the deadline maths to `src/domain/templates.ts`, the storage, a server module `src/server/instances/`, and two screens.

**Tech Stack:** TanStack Start, Drizzle + SQLite (better-sqlite3), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §4 (Instance), §5.3 (origins 2 and 3, deadline rule), §5.5, §5.6; UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §7.1 TLog, §7.2 GTasks.

**Out of scope (#39):** scheduled instances, and expiring instances after grace. Until #39, an open deadline instance past its grace window stays `open` and refuses Hotovo (`past_grace`, already in the domain). The `recurring` and `log` switches stay off in production; previews have them on through the demo seed ([#184 Previews start with every launch switch on](https://github.com/SlatinskyJ/taskmaster/pull/184); this branch rebases on it once merged).

**Size:** about 550 changed lines without tests, the migration and generated files: schema 40, domain 30, server 220, screens and strings 220, demo seed 40. One PR and not a stack, because the two origins share the schema, the server module and the task views; a server-only PR would ship storage no screen can reach and need the same views reworked in the screens PR. Under the 800 line mark.

## Global Constraints

- UI labels in Czech, only in `src/lib/strings.ts`. Code, identifiers, DB, commits, logs in English.
- Prague wall-clock maths only through `src/domain/dates.ts`; store UTC with `toIsoUtc`.
- `src/domain/` stays framework-free.
- Every state change writes its audit entry in the same transaction (`writeAudit`), entity type `task` for instance rows.
- Never edit a committed migration: add `drizzle/0018_*` via `pnpm db:generate --name instances`.
- Scores are whole numbers ≥ 1; an instance's score is the template's score **at the moment it is created** (spec §4) and never changes afterwards.
- Self-logged instances **always** need approval, whatever the template's flag (spec §5.3).
- Every tap target ≥ 44 px (`min-h-tap` / `size-tap`); every animation has a `motion-reduce:` opt-out.

## Rulings (where the spec leaves the choice to the builder, §10; all go into the PR brief)

1. **Storage:** instances live in `tasks`, not a table of their own. The task lifecycle, points, meeting and week code all read `tasks`; a second table would need a union in each of them. The comment in `src/server/tasks/lifecycle.ts` ("their own table") is updated.
2. **Copied at creation:** `title`, `score` and `approval_required` come from the template when the instance is made (self-logged: `approval_required = true`). A later template score change does not touch existing instances (spec §5.1).
3. **Audit:** instance birth writes `instance.created` (on demand) or `instance.self_logged`, entity type `task`, entity id = the row id. Later steps on an instance row reuse the existing `task.*` steps and actions (`task.reserved`, `task.completed`, `task.approved`, `task.rejected`, `task.cancelled`), so the task history, `rejections.ts` and Týden read them unchanged. The unused `instance.*` action names stay in the list (never removed).
4. **No price change on an instance:** `proposeTaskScoreChange` refuses an instance row with `not_allowed`; the task page hides the price panel for instances. The score is fixed at creation (spec §4).
5. **On-demand deadline:** a deadline template's on-demand instance gets its due time from the moment "+ Teď" is tapped, by the same rule as a scheduled one. Self-logged instances have no deadline (they are born done).
6. **Template must be agreed:** both origins refuse a proposed template (`not_agreed`).
7. **Self-log while an instance of the same template is open:** allowed; the giver's approval is the check. (Spec is silent; asked Jakub on a decision card in the project thread, recommended "allow". If he answers otherwise, the plan gets a refusal `already_open` before the build.)
8. **Zapsat asks first:** a taker cannot take back a self-log, so tapping a tile opens a Dialog "Zapsat {title} za {n} b.?" (UI doc §5: Dialog for actions that can't be undone by the person). "+ Teď" needs no Dialog: the giver can cancel the instance.

## Review Focus

1. A deadline instance made at or after its due clock time on the due day ("+ Teď" for bins at 07:30 with "týž den, 7:00") must be due the next day, not already overdue: test at exactly 07:00 and 06:59 (Task 1).
2. A due time across the DST switch (last Sunday of March / October) keeps the Prague clock time: test (Task 1).
3. A taker who self-logs twice by double tap gets two rows; the Dialog's confirm button is disabled while busy, so a double tap sends once (Task 6 component test).
4. A rejected self-log must not come back as open or count points anywhere (points, meeting pending, Týden): test that points, `listPendingCompletions` and `listBoard` skip a `rejected` row (Task 3).
5. A template whose score changes after an instance was made: the instance keeps the old score (Task 3).

---

### Task 1: Deadline of an instance (domain)

**Files:**
- Modify: `src/domain/templates.ts`
- Test: `src/domain/templates.test.ts`

**Interfaces:**
- Consumes: `addPragueDays`, `startOfPragueDay`, `toPragueWallTime`, `fromPragueWallTime` from `./dates`; `Deadline` from `./lifecycle`.
- Produces: `instanceDeadline(rule: DeadlineRule, appearsAt: Date): Deadline`.

- [ ] **Step 1: Write the failing tests** in `templates.test.ts`, `describe('instanceDeadline')`:
  - `"next day, 7:00", grace 60, appears Tue 2026-11-24 18:00 Prague` → `dueAt` = Wed 2026-11-25 07:00 Prague (`06:00Z`), `graceEndsAt` = `07:00Z`.
  - `"same day, 7:00"`, appears 06:59 → due same day 07:00.
  - `"same day, 7:00"`, appears exactly 07:00 → due next day 07:00 (spec §5.3: "already passed" includes the same instant; the domain's windows are half-open, see `pastGrace`).
  - `"same day, 7:00"`, appears 07:30 → due next day 07:00.
  - DST: `"next day, 7:00"`, appears Sat 2026-03-28 18:00 → due Sun 2026-03-29 07:00 CEST (`05:00Z`); appears Sat 2026-10-24 18:00 → due Sun 2026-10-25 07:00 CET (`06:00Z`).
  - grace 0 → `graceEndsAt` equals `dueAt`.
- [ ] **Step 2: Run** `pnpm vitest run src/domain/templates.test.ts` — expected FAIL (`instanceDeadline` not exported).
- [ ] **Step 3: Implement** `instanceDeadline`: day = `addPragueDays(startOfPragueDay(appearsAt), rule.dayOffset)`, due = that day at `rule.due`; if `due <= appearsAt`, due = `addPragueDays(due, 1)`; `graceEndsAt = due + graceMinutes * 60_000`. Export it from `src/domain/index.ts` (barrel already re-exports `templates`; check).
- [ ] **Step 4: Run** the same command — expected PASS.
- [ ] **Step 5: Commit** `Domain: due time of an instance`.

### Task 2: Storage for instances

**Files:**
- Modify: `src/server/db/schema/tasks.ts`
- Create: `drizzle/0018_instances.sql` (generated) + `drizzle/meta/*`
- Test: `src/server/db/schema.test.ts` (existing schema tests; add cases) or a new `src/server/db/instances.test.ts`

**Interfaces:**
- Produces on `tasks`: `templateId: integer('template_id').references(() => templates.id)` (null = one-time), `origin: text('origin', { enum: TASK_ORIGINS }).notNull().default('one_time')`, `dueAt: text('due_at')`, `graceEndsAt: text('grace_ends_at')`.
- `TASK_ORIGINS = ['one_time', 'on_demand', 'self_logged', 'scheduled'] as const` (`scheduled` is written by #39; it is in the CHECK now so #39 needs no rebuild). Same names as the domain's `ItemOrigin`.
- `TASK_STATUSES` gains `'expired'` (written by #39) and `'rejected'`.

- [ ] **Step 1: Write the failing tests:** an insert with `status: 'rejected'` and `origin: 'self_logged'` succeeds; `origin: 'one_time'` with a `template_id` is refused by CHECK `tasks_origin_check` (`(origin = 'one_time') = (template_id IS NULL)`); `due_at` without `grace_ends_at` refused (`tasks_deadline_check`: both null or both set, and only on an instance); `status: 'teleported'` still refused.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3:** edit the schema (CHECKs: status list + `'expired', 'rejected'`; `tasks_origin_check`; `tasks_deadline_check`; `index('tasks_template_idx').on(t.templateId)`), then `pnpm db:generate --name instances`. Read the generated SQL: a table rebuild (`__new_tasks`) that copies every column, existing rows get `origin = 'one_time'`. `applyMigrations` already turns foreign keys off around rebuilds.
- [ ] **Step 4: Run** the tests and `pnpm db:check` — PASS.
- [ ] **Step 5:** add a test in `src/server/db/migrate.test.ts` (or the existing migration test file) that a database with a one-time task row made at migration 0017 keeps it, with `origin = 'one_time'`, after 0018, and its `task_thread` rows still point to it.
- [ ] **Step 6: Commit** `Tasks table holds recurring instances`.

### Task 3: Item mapping and views know instances

**Files:**
- Modify: `src/server/tasks/item.ts`, `src/server/tasks/tasks.ts` (views), `src/server/tasks/scoreChange.ts`, `src/server/tasks/lifecycle.ts` (comment only), `src/server/tasks/history.ts`
- Test: `src/server/tasks/item.test.ts` (new), `src/server/tasks/scoreChange.test.ts`, `src/server/tasks/history.test.ts`

**Interfaces:**
- `toItem(row)` returns `origin: row.origin`, `deadline: row.dueAt && row.graceEndsAt ? { dueAt, graceEndsAt } : null`, and maps `expired` and `rejected` (rejected carries its completion). `columnsOf(item)` writes `expired` (no reservation / completion) and `rejected` (completion kept) instead of throwing.
- `TaskView` gains `origin: TaskOrigin`, `templateId: number | null`, `dueAt: string | null`, `graceEndsAt: string | null` (UTC ISO).
- `TaskHistoryAction` widens to `Extract<AuditAction, \`task.${string}\` | 'instance.created' | 'instance.self_logged'>`.
- `proposeTaskScoreChange` on a row with `origin !== 'one_time'` → `fail('not_allowed')`.

- [ ] **Step 1: Write the failing tests:**
  - `item.test.ts`: a `rejected` self-logged row round-trips through `toItem` / `columnsOf` with its completion; an on-demand row with due/grace columns gives `deadline` as `Date`s; one-time rows unchanged (origin `one_time`, deadline null).
  - `completeTask` on an instance row whose `graceEndsAt` ≤ now → `past_grace`; 1 ms before → done (boundary).
  - `rejectTask` on a self-logged pending row → status `rejected`, `earnerId` kept, `takerPoints` counts neither confirmed nor pending for it, `listPendingCompletions` and `listBoard` leave it out.
  - `proposeTaskScoreChange` on an open on-demand instance → `not_allowed`, no audit row.
  - `taskHistory` returns an `instance.self_logged` entry with its score.
- [ ] **Step 2: Run** `pnpm vitest run src/server/tasks` — FAIL.
- [ ] **Step 3: Implement** the interfaces above. Instance rows are inserted directly in Task 4 (no `insertRow` helper here).
- [ ] **Step 4: Run** — PASS; then the whole `pnpm test` (views changed shape: fix only fixtures that build a `TaskView` by hand, e.g. `src/components/meeting/fixtures.ts`, `src/components/week/fixtures.ts`, adding the four new fields).
- [ ] **Step 5: Commit** `Task lifecycle and views handle instances`.

### Task 4: Server: "+ Teď" and self-log

**Files:**
- Create: `src/server/instances/instances.ts`, `src/server/instances/functions.ts`, `src/server/instances/index.ts`
- Test: `src/server/instances/instances.test.ts`, `src/server/instances/functions.test.ts`

**Interfaces:**
- Consumes: `createInstance`, `selfLog`, `byPerson`, `findPerson` (domain); `instanceDeadline` (Task 1); `columnsOf` (Task 3); `writeAudit`; `listPeople`; `templates` row (`status === 'active'`); template deadline columns → `DeadlineRule` (reuse the row→rule mapping in `src/server/templates/templates.ts`; export it as `deadlineRuleOf(row: TemplateRow): DeadlineRule | null`).
- Produces:
  - `type InstanceError = LifecycleError | 'not_found' | 'not_agreed'`
  - `createOnDemandInstance(db: Db | Tx, giverId: number, templateId: number, now?: Date): Result<TaskRow, InstanceError>` — audit `instance.created`, `after` = `{ templateId, origin, status, score, dueAt, graceEndsAt }`.
  - `selfLogInstance(db: Db | Tx, takerId: number, templateId: number, now?: Date): Result<TaskRow, InstanceError>` — row `done_unconfirmed`, `completedBy = earnerId = takerId`, `completedAt = now`, `approvalRequired = true`; audit `instance.self_logged`.
  - `listLoggableTemplates(db: Db | Tx): { id: number; title: string; score: number }[]` — active templates, by title (Czech collation `localeCompare(…, 'cs')`).
  - Server fns: `createInstanceFn` (`requireRole('giver')`, validator `parseTemplateId`), `selfLogFn` (`requireRole('taker')`), `listLoggableTemplatesFn` (`requireRole('taker')`). Result `{ ok: true; id: number; score: number } | { ok: false; error: InstanceError }`.

- [ ] **Step 1: Write the failing tests** (`instances.test.ts`, family from `~/server/tasks/testing`, template from `agreedTemplate`):
  - giver "+ Teď" on an agreed no-deadline template → open row, score 3, `origin: 'on_demand'`, `templateId` set, `dueAt` null, one `instance.created` audit row with actor Táta; twice the same minute → two rows (several per day, spec §5.3).
  - deadline template ("další den 7:00", grace 60) at Tue 18:00 Prague → `dueAt`/`graceEndsAt` as Task 1.
  - template score changes 3 → 5 after an instance was made: the old instance keeps 3, a new one gets 5.
  - wrong actors: a taker calls `createOnDemandInstance` → `not_a_giver`; a giver calls `selfLogInstance` → `not_a_taker`; admin → `not_allowed`/`not_a_giver`; nothing written.
  - proposed template → `not_agreed`; unknown id → `not_found`.
  - self-log on a template with `approvalRequired: false` → still `done_unconfirmed`, `approvalRequired: true`; approve → `confirmed`, points +3 for that taker; reject → `rejected`.
  - rollback: with a trigger that aborts inserts into `audit_log`, both actions throw and leave no `tasks` row.
  - `listLoggableTemplates`: only active, sorted by Czech title ("Čistit…" after "Cvičit…").
- [ ] **Step 2: Run** `pnpm vitest run src/server/instances` — FAIL.
- [ ] **Step 3: Implement** in one transaction each: load template, check `active`, ask the domain (`createInstance(byPerson(p), 'on_demand', row.approvalRequired, deadline)` / `selfLog(byPerson(p), now)`), insert with `columnsOf(item)` plus `title`, `score`, `templateId`, `origin`, `dueAt`, `graceEndsAt`, `createdBy` = actor, `createdAt`/`updatedAt` = now, `agreedAt` = template's `agreedAt`, then `writeAudit`.
- [ ] **Step 4: Write `functions.test.ts`:** the three server functions through their real handlers (pattern of `src/server/tasks/functions.test.ts`): role guard refuses the wrong role; the success result shape is exactly `{ ok, id, score }` (no row fields leak).
- [ ] **Step 5: Run** — PASS. **Commit** `Server: instances on demand and self-logged chores`.

### Task 5: Úkoly: "+ Teď" on agreed templates, instance rows show their due time

**Files:**
- Modify: `src/components/templates/TemplateRow.tsx`, `src/routes/_app/ukoly/index.tsx`, `src/components/tasks/taskGroups.ts`, `src/lib/strings.ts`, `src/lib/formatDate.ts`
- Test: `src/components/tasks/ukolyPage.test.tsx`, `src/lib/formatDate.test.ts`

**Interfaces:**
- `TemplateRow` gets an optional `onNow?: () => void` and `busy?: boolean`; with `onNow`, an active row shows a second 44 px button "+ Teď" (`cs.instances.now`) left of the price link. The action area wraps under the name at 360 px (flex-wrap), the name keeps its two-line clamp.
- `formatDue(iso: string, now: Date): string` → `"do 7:00"` same Prague day, `"do zítra 7:00"` next day, else `"do st 7:00"` (weekday from `cs.templates.days`, lower case). Through `toPragueWallTime`.
- `GROUP_LABEL` / `GROUP_ORDER` add `rejected` (`cs.state.rejected`) and `expired` (`cs.state.expired`) at the end.
- Strings (`cs.instances`): `now: '+ Teď'`, `toast.created: 'Přidáno do úkolů'`, `error`: Czech text per `InstanceError` (`not_agreed: 'Cenu ještě neodsouhlasili všichni.'`, generic `'Nepovedlo se. Zkus to znovu.'`).
- Úkoly: the top section label becomes `cs.templates.itemsSection = 'Úkoly'` when `recurring` is on (it now holds instances too); a row of an instance with `dueAt` shows `formatDue` as its meta when nothing else does.

- [ ] **Step 1: Write the failing tests:** `formatDue` cases (same day, next day, three days later, across midnight Prague vs UTC: `2026-11-24T23:30Z` is already Wednesday in Prague); Úkoly with `recurring` on: an active template row has "+ Teď", a proposed one does not; tapping it calls `createInstanceFn` with the template id, the button is disabled while busy, a failure shows the Czech error toast and the button works again; with `recurring` off no "+ Teď"; an instance row shows "do zítra 7:00".
- [ ] **Step 2: Run** `pnpm vitest run src/components/tasks/ukolyPage.test.tsx src/lib/formatDate.test.ts` — FAIL.
- [ ] **Step 3: Implement** with the existing `useTaskAction` (busy key `now-<templateId>`, toast, `router.invalidate()`).
- [ ] **Step 4: Run** — PASS. **Commit** `Úkoly: + Teď makes an instance`.

### Task 6: Zapsat: the taker logs a chore

**Files:**
- Modify: `src/routes/_app/zapsat.tsx`, `src/lib/strings.ts`
- Create: `src/components/instances/LogTiles.tsx`
- Test: `src/components/instances/logTiles.test.tsx`

**Interfaces:**
- Loader: `listLoggableTemplatesFn()`. `LogTiles({ templates, onLogged })`: a two-column grid of tiles (`min-h-tap`, title wraps up to three lines then clamps, points in a chip that never wraps), tap → Dialog `cs.log.confirmTitle` "Zapsat úkol?" with body "{title} za {n} b. Rodič to ještě schválí." and buttons Zpět / Zapsat (confirm disabled while busy). Success: toast `cs.log.toast` "Zapsáno, čeká na schválení", floating "+n" in the pending colour (existing `FloatingPoints`, already `motion-reduce` safe), Dialog closes. Failure: Czech error toast, Dialog stays open.
- Empty state: `cs.log.empty` "Zatím tu nejsou žádné opakované úkoly." Loader error: the route's existing `RouteError`.
- Strings `cs.log`: `intro: 'Udělal jsi něco sám od sebe? Zapiš to.'`, `confirmTitle`, `confirmBody(title, n)`, `confirm: 'Zapsat'`, `toast`, `empty`.

- [ ] **Step 1: Write the failing tests:** tiles render sorted as the server sends them; tap opens the Dialog with the title and points; confirm calls `selfLogFn({ data: { templateId } })` once even on a double click; success toast + Dialog closed; failure toast + Dialog open; empty list → empty state.
- [ ] **Step 2: Run** `pnpm vitest run src/components/instances` — FAIL.
- [ ] **Step 3: Implement.** The task page (`src/routes/_app/ukol/$taskId.tsx`) hides `ScoreChangePanel` when `task.origin !== 'one_time'` (test in `src/components/tasks/tasks.test.tsx`).
- [ ] **Step 4: Run** — PASS. **Commit** `Zapsat: log a chore done unprompted`.

### Task 7: Demo data and end-to-end

**Files:**
- Modify: `src/server/demo/seed.ts` (new function `seedInstances(tx, id, now)`, called after the templates), `src/server/demo/seed.test.ts`
- Create: `e2e/recurring.spec.ts`; Modify `playwright.config.ts` (own server, project `recurring`, port 3105)

- [ ] **Step 1: Seed test:** the demo has one on-demand instance of "Vyndat myčku" (open, 3 b.), one on-demand deadline instance of a bins template due tomorrow 7:00, and one self-logged "Vyndat myčku" by Mladší waiting for approval; the meeting's pending count and the points totals in the existing seed tests are updated to match (numbers in those tests change because the data changes, not because a check is weakened).
- [ ] **Step 2: e2e** (`recurring.spec.ts`, 360×800): Táta taps "+ Teď" on "Vyndat myčku" → the open row appears in Úkoly; Starší opens Zapsat, logs "Vyndat myčku", sees the toast and his pending points go up on Domů; Táta approves it on Domů.
- [ ] **Step 3: Run** `pnpm build && pnpm exec playwright test --trace off` — all pass.
- [ ] **Step 4: Commit** `Demo data and e2e for instances`.

### Task 8: Verify

- [ ] `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm db:check` — all green.
- [ ] `pnpm mutation --mutate src/domain/templates.ts src/server/instances/instances.ts` — note surviving mutants; add tests for any that a real bug could hide behind.
- [ ] Screenshots at 360×800 (UX judge) and 393×852 ×3 (brief): Úkoly with "+ Teď", an instance row with a due time, Zapsat tiles, the Zapsat Dialog, Zapsat empty, the task page of an instance; long name "Vyluxovat celý obývák a chodbu" as a template.
