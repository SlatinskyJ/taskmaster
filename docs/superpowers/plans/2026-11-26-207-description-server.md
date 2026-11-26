# Descriptions on tasks and chores, server half: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store an optional description on one-time tasks and templates. Copy it to instances when they are made. Let givers change it, with a taker's OK once the task or chore is agreed, as spec §5.1, §5.2 and §5.3 say. All of it is behind a new `descriptions` launch switch.

**Architecture:** The rules live in a new framework-free module, `src/domain/description.ts`. The server module `src/server/descriptions/` loads a task or template and its waiting change, asks the domain, and writes rows plus audit entries in one transaction. One new table, `description_changes`, holds a waiting change for a task or a template. It follows the pattern of `task_score_changes`: never deleted, at most one open per target. Server functions are added. The screens come in the next PR of the stack: Nový úkol field, page text, edit sheet, OK/no card, history lines, seed piece, e2e and keyboard cases.

**Tech Stack:** TypeScript strict, Drizzle + SQLite, TanStack Start server functions, vitest.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md`: §4 Description row, §5.1 "Description of a template", §5.2 "Description of a one-time task", §5.3 "Description".

**Issue:** [#207 Add a description to tasks and chores](https://github.com/SlatinskyJ/taskmaster/issues/207). PR 1 of 2 (this one is the server). The issue closes with PR 2.

## Global Constraints

- Up to 1000 characters, line breaks kept, no formatting (§4).
- One-time task (§5.2):
  - any giver may write or change the description; a taker never does;
  - while the task is proposed, a change applies at once. Reopened bidding on an open task counts as open, not proposed;
  - reserved: the change needs the OK of the taker who reserved it;
  - open: the change needs the OK of any one taker;
  - until the OK, the old description stays;
  - one change may be in flight; a giver's new change replaces it;
  - a taker's "no" closes it;
  - the OK changes only the description, never the score;
  - once completed, the description is frozen;
  - every change, OK and "no" is logged.
- Template (§5.1): any giver may change it. While proposed it applies at once; after agreement it needs one taker's OK. A changed description applies only to instances created after the OK.
- Instance (§5.3): takes the template's description at the moment it is created. It has no rule of its own for changes, so it is not changeable (see Rulings).
- Codebase rules (CLAUDE.md):
  - Czech text only in `src/lib/strings.ts` (this PR adds none);
  - every state change goes through `writeAudit` in the same transaction;
  - the migration comes from `pnpm db:generate`;
  - the launch switch is off in prod.

## Rulings (spec is silent; listed in the brief, Jakub may overturn)

1. **Back to proposed.** A release of a bid-won reservation sends the task back to `proposed` (§5.4). A change waiting at that moment is **discarded**, and the old text stays. The giver can change it again at once, since a proposed task needs nobody's OK.
2. **Completed, cancelled or expired** (any status other than proposed, open or reserved): a waiting change is discarded, logged as `*.description_change_discarded`.
3. **Reserved ↔ open while a change waits** (release, reserve): the change stays. Who may OK it follows the task's state at the moment of the answer.
4. **Instances** are not changeable (`not_changeable`). Their text is a copy from creation.
5. **Changing back.** A giver who sets the text that is in force while a change waits closes that change as `withdrawn`, and nothing else changes. With no change waiting, the same text is `same_description`.
6. **Normalising.** `\r\n` and `\r` become `\n`, and the whole text is trimmed. Empty means no description (`null`). The length is counted after normalising, in UTF-16 code units (`String.length`, like the 1000-character limits elsewhere).

## Review Focus

1. **A stale screen.** A taker OKs a change that was replaced a second ago. Refuse with `offer_changed`; the answer names the `changeId` it saw.
2. **Release while a reserved change waits.** The change now needs any taker's OK, not the old reserver's. Test: release, then another taker OKs, and it applies.
3. **The 1001st character after `\r\n` normalising.** 1000 `a`s plus a trailing `\r\n` is fine (it is trimmed). 1001 characters is refused with `description_too_long`, also on create.
4. **Switch off.** Every new server function returns `feature_off`. Creating with a non-empty description returns `feature_off`; creating with no description still works.
5. **An instance made while a template change waits** gets the old text. After the OK, the next instance gets the new text.

---

### Task 1: Domain rules, `src/domain/description.ts`

**Files:**
- Create: `src/domain/description.ts`, `src/domain/description.test.ts`
- Modify: `src/domain/index.ts` (re-export)

**Interfaces (Produces):**
```ts
export const DESCRIPTION_MAX = 1000
export type DescriptionError =
  | 'description_too_long' | 'not_a_giver' | 'not_a_taker' | 'not_involved'
  | 'description_frozen' | 'not_changeable' | 'same_description'
/** Who must OK a change now. `direct` = applies at once. */
export type DescriptionRule =
  | { kind: 'direct' } | { kind: 'any_taker' } | { kind: 'taker'; takerId: PersonId }
export function normalizeDescription(raw: string): Result<string | null, 'description_too_long'>
export function taskDescriptionRule(item: Item): Result<DescriptionRule, DescriptionError>
export function templateDescriptionRule(status: TemplateAgreement['status']): DescriptionRule
/** A giver changes the text: applies now, waits for an OK, or withdraws the waiting change (ruling 5). */
export function changeDescription(
  rule: DescriptionRule, current: string | null, pending: string | null | undefined,
  people: readonly Person[], giverId: PersonId, next: string | null,
): Result<'apply' | 'wait' | 'withdraw', DescriptionError>
/** A taker answers the waiting change. */
export function answerDescription(
  rule: DescriptionRule, people: readonly Person[], takerId: PersonId,
): Result<true, DescriptionError>
/** Whether a waiting change survives the task's new state (rulings 1 to 3). */
export function keepsDescriptionChange(item: Item): boolean
```
Here `pending` is the waiting change's text: `undefined` means no change is waiting, and `null` means a waiting removal.

- [ ] **Step 1: Write the failing tests** in `description.test.ts`:
  - `normalizeDescription`:
    - `'  a\r\nb\r '` → `ok('a\nb')`;
    - `'   '` → `ok(null)`;
    - `'a'.repeat(1000) + '\r\n'` → ok;
    - `'a'.repeat(1001)` → `fail('description_too_long')`.
  - `taskDescriptionRule`:
    - proposed → direct;
    - open → any_taker;
    - open with a reopened round → any_taker (the `Item` has no round, so this is the same case; the server test pins it in Task 3);
    - reserved by 7 → `{kind:'taker', takerId: 7}`;
    - `done_unconfirmed` and `confirmed` → `description_frozen`;
    - cancelled → `description_frozen`;
    - an instance (`origin: 'on_demand'`) → `not_changeable`.
  - `templateDescriptionRule('proposed')` → direct; `('agreed')` → any_taker.
  - `changeDescription`:
    - a taker → `not_a_giver`;
    - an inactive giver → `not_a_giver`;
    - direct → `'apply'`;
    - any_taker or taker → `'wait'`;
    - next equals current with no change waiting → `same_description`;
    - next equals current while a change waits → `'withdraw'`;
    - next equals the waiting text → `same_description`.
  - `answerDescription`:
    - a giver → `not_a_taker`;
    - any_taker with an active taker → ok;
    - taker rule with another taker → `not_involved`;
    - direct → `not_involved` (nothing waits on a proposed task).
  - `keepsDescriptionChange`: true for open and reserved one-time tasks; false for proposed, done_unconfirmed, confirmed and cancelled.
- [ ] **Step 2:** Run `pnpm vitest run src/domain/description.test.ts`. Expect FAIL (module missing).
- [ ] **Step 3:** Implement. Use `isActiveAs` from `./parties`. `taskDescriptionRule` switches on `item.status` like `changeRule` in `scoreChange.ts`.
- [ ] **Step 4:** Run the same command. Expect PASS.
- [ ] **Step 5:** Commit `Domain rules for task and chore descriptions (#207)`.

### Task 2: Schema, migration, switch, audit names

**Files:**
- Modify:
  - `src/server/db/schema/tasks.ts` (column);
  - `src/server/db/schema/templates.ts` (column);
  - `src/server/db/schema/index.ts` (export);
  - `src/server/audit/actions.ts`;
  - `src/lib/features.ts`;
  - `src/server/features/README.md`;
  - the switch tests that list every key (`src/lib/nav.test.ts`, `src/server/demo/seed.test.ts`, `src/server/features/flags.test.ts`).
- Create:
  - `src/server/db/schema/descriptions.ts`;
  - `drizzle/00NN_descriptions.sql` (generated);
  - `drizzle/00NN+1_descriptions_switch.sql` (custom).
- Test: `src/server/db/descriptions-schema.test.ts`

**Interfaces (Produces):**
- `tasks.description` and `templates.description`: `text('description')`, nullable. No CHECK; the limit is in the domain, like the other `[call]` limits.
- `descriptionChanges` table `description_changes` has these columns:
  - `id`;
  - `taskId` → tasks, nullable;
  - `templateId` → templates, nullable;
  - `description` text, nullable (null = remove);
  - `proposedBy` → users, not null;
  - `createdAt`;
  - `closedAt`;
  - `closedAs`, from `DESCRIPTION_CHANGE_CLOSINGS = ['agreed','declined','withdrawn','replaced','discarded']`;
  - `closedBy` → users, nullable.

  CHECKs:
  - exactly one of `taskId` / `templateId` is set;
  - `closedAt` and `closedAs` are both null or both set, with `closedAs` in the list.

  Partial unique indexes `…_open_task_idx` on `task_id` and `…_open_template_idx` on `template_id`, both `WHERE closed_at IS NULL`.
- Audit actions (append; names are never removed):
  - `task.description_changed`, `task.description_change_proposed`, `task.description_change_approved`, `task.description_change_declined`, `task.description_change_withdrawn`, `task.description_change_discarded`;
  - `template.` with the same five verbs, minus discarded (a template never stops being changeable).
- `FEATURE_KEYS` gains `'descriptions'` (doc comment `/** Descriptions on tasks and chores (#207). */`). It is false in `NO_FEATURES` and true in `ALL_FEATURES`.

- [ ] **Step 1: Write the failing test.** `descriptions-schema.test.ts` uses `createTestDb()`:
  - a row with both ids is refused;
  - a row with neither id is refused;
  - a second open row for the same task is refused;
  - a closed row plus a new open row is fine;
  - `tasks.description` round-trips `'a\nb'`.
- [ ] **Step 2:** Run `pnpm vitest run src/server/db/descriptions-schema.test.ts`. Expect FAIL.
- [ ] **Step 3:** Add the columns and the table.
  - Run `pnpm db:generate --name descriptions`.
  - Then run `pnpm db:generate --custom --name descriptions_switch` and fill it with this SQL:
    ```sql
    -- Launch switch for descriptions on tasks and chores (#207). Off until Jakub turns it on.
    INSERT INTO `feature_flags` (`key`, `enabled`) VALUES ('descriptions', 0);
    ```
  - Number both migrations from main at build time. If another PR (#230 takes 0032) lands first, renumber by regenerating; never edit a committed migration.
  - Add the README line, the switch keys, and the flags-test title part `descriptions off (00NN+1)`.
- [ ] **Step 4:** Run `pnpm db:check && pnpm vitest run src/server/db src/server/features src/lib/nav.test.ts src/server/demo/seed.test.ts`. Expect all to pass.
- [ ] **Step 5:** Commit `Description columns, waiting changes table and descriptions switch (#207)`.

### Task 3: Server module `src/server/descriptions/`

**Files:**
- Create:
  - `src/server/descriptions/descriptions.ts`;
  - `index.ts`;
  - `descriptions.test.ts`;
  - `README.md` (five lines: what it owns, the rulings).
- Modify:
  - `src/server/tasks/lifecycle.ts:98` (the discard hook, next to `discardStaleChange`);
  - `src/server/tasks/tasks.ts` (`NewTask.description?`, `createTask` writes it and puts it in the `task.created` `after`);
  - `src/server/templates/templates.ts` (`NewTemplate.description?`, the same for `createTemplateIn`);
  - `src/server/instances/instances.ts:75` (`description: template.description` in `insertInstance`).

**Interfaces (Produces):**
```ts
export type DescriptionTarget = { kind: 'task'; id: number } | { kind: 'template'; id: number }
export type DescriptionServerError = DescriptionError | 'not_found' | 'no_change' | 'offer_changed'
export interface WaitingDescription {
  id: number; description: string | null; proposedBy: number; createdAt: string
  /** Active takers whose OK would apply it, in people order (reserved: just the reserver). */
  waitingFor: number[]
}
export function changeDescriptionOf(db: Db | Tx, target: DescriptionTarget, giverId: number,
  raw: string, now?: Date): Result<'applied' | 'waiting' | 'withdrawn', DescriptionServerError>
export function answerDescriptionChange(db: Db | Tx, target: DescriptionTarget, takerId: number,
  changeId: number, yes: boolean, now?: Date): Result<'agreed' | 'declined', DescriptionServerError>
export function waitingDescriptionOf(db: Db | Tx, target: DescriptionTarget): WaitingDescription | null
/** Lifecycle caller duty (rulings 1–2): closes a change the task's new state no longer keeps. */
export function discardStaleDescription(tx: Tx, row: TaskRow, actor: Actor, now: Date): void
```

What each call writes, with `before`/`after` = `{ description, changeId? }`:
- applied → `*.description_changed`;
- waiting → `*.description_change_proposed`, plus `replacedId` in `after` when a change was replaced (the replaced row closes `replaced`, `closedBy` = the giver);
- withdrawn → `*.description_change_withdrawn`;
- an OK → `*.description_change_approved` with `before` the old text, `after` the new one. The row closes `agreed` and the target's `description` is set. The score and `updatedAt` stay; only `description` changes;
- a no → `*.description_change_declined`;
- a discard → `task.description_change_discarded`.

- [ ] **Step 1: Write the failing tests** in `descriptions.test.ts`, using the task and template helpers in `src/server/tasks/testing.ts` and `src/server/templates/testing.ts`:
  - a proposed task: a giver's change applies at once, with one `task.description_changed` entry;
  - an open task: the change waits, `tasks.description` is unchanged, and `waitingFor` is both takers. Either taker's OK applies it with one `approved` entry, and `tasks.score` is unchanged;
  - an open task in a reopened round (`biddingFrom` set): still waits (Review Focus, open not proposed);
  - a reserved task: the other taker's OK → `not_involved`; the reserver's OK applies it;
  - Review Focus 2: a reserved task with a waiting change, then release → open, then the other taker's OK applies it;
  - ruling 1: a bid-won reservation is released back to proposed. The change closes `discarded` with one `task.description_change_discarded` entry, logged after `task.released`;
  - completion discards the change (ruling 2);
  - a giver's second change replaces the first: the old row is `replaced`, and the entry carries `replacedId`;
  - Review Focus 1: an OK naming the replaced `changeId` → `offer_changed`; with no change → `no_change`;
  - a taker's no: the row is `declined`, the text is unchanged;
  - ruling 5: changing back to the text in force while a change waits → `withdrawn`;
  - a template, proposed: applies at once. Agreed: waits, and a taker OKs it;
  - Review Focus 5: an instance made while the change waits gets the old text; after the OK, the next instance gets the new one;
  - `createTask` with `description: ' x\r\n'` stores `'x'`; with 1001 characters → `description_too_long`;
  - `changeDescriptionOf` by a taker → `not_a_giver`; on an instance → `not_changeable`; on a confirmed task → `description_frozen`.
- [ ] **Step 2:** Run `pnpm vitest run src/server/descriptions`. Expect FAIL.
- [ ] **Step 3:** Implement. Each exported write runs in `db.transaction`, loads the row, `listPeople(tx)` and the open change, asks the domain, then writes the rows and `writeAudit` entries. In `lifecycle.ts`, call `discardStaleDescription(tx, saved, actor, now)` right after `discardStaleChange`.
- [ ] **Step 4:** Run `pnpm vitest run src/server`. Expect PASS (existing create and instance tests keep passing; `description` is optional).
- [ ] **Step 5:** Commit `Change, approve and decline descriptions on the server (#207)`.

### Task 4: Views and server functions behind the switch

**Files:**
- Modify:
  - `src/server/tasks/tasks.ts`: `TaskView.description: string | null`, `TaskDetail.descriptionChange: WaitingDescription | null`;
  - `src/server/templates/templates.ts`: `TemplateView.description`, `TemplateDetail.descriptionChange`;
  - `src/server/tasks/functions.ts`;
  - `src/server/templates/functions.ts`.
- Create: `src/server/descriptions/functions.ts`, `src/server/descriptions/functions.test.ts`.

**Interfaces (Produces):**
```ts
export type DescriptionResult =
  | { ok: true; outcome: 'applied' | 'waiting' | 'withdrawn' | 'agreed' | 'declined' }
  | { ok: false; error: DescriptionServerError | 'feature_off' }
export function parseDescriptionChange(data: unknown): { target: DescriptionTarget; description: string }
export function parseDescriptionAnswer(data: unknown): { target: DescriptionTarget; changeId: number; yes: boolean }
export function changeDescriptionHandler(db: Db, userId: number, data: ReturnType<typeof parseDescriptionChange>, now: Date): DescriptionResult
export function answerDescriptionHandler(db: Db, userId: number, data: ReturnType<typeof parseDescriptionAnswer>, now: Date): DescriptionResult
export const changeDescriptionFn   // POST, requireRole('giver')
export const answerDescriptionFn   // POST, requireRole('taker')
```
- When the switch is off, `TaskView.description` and `descriptionChange` read `null`, so the screens show nothing. The value is read once per call through `getFlags`.
- `createTaskFn` and `createTemplateFn` validators accept an optional `description` string, at most 4000 raw characters before normalising, as the DoS cap. Their handlers return `{ ok: false, error: 'feature_off' }` when it is non-empty and the switch is off.
- The parsers reject a non-integer id, an unknown `kind`, a non-string description and a non-boolean `yes` (throw, like `parseTaskId`).

- [ ] **Step 1: Write the failing tests** in `functions.test.ts`:
  - switch off: both handlers → `feature_off`;
  - switch off: a create with a description → `feature_off`, a create without one → ok;
  - switch off: `getTaskDetail(...).task.description` is null even when the column is set;
  - switch on: a full round trip (change on an open task → `waiting`, a taker's answer `yes` → `agreed`, and the detail shows the text);
  - the parser cases above.
- [ ] **Step 2:** Run `pnpm vitest run src/server/descriptions/functions.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement, following `withdrawBidHandler` / `reopenBiddingHandler` in `src/server/tasks/functions.ts`.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck && pnpm lint`. Expect all to pass.
- [ ] **Step 5:** Commit `Description server functions behind the descriptions switch (#207)`.

### Task 5: Finish

- [ ] Run `pnpm db:check && pnpm build && pnpm e2e --trace off`. All must pass (no screen changes, so no new e2e).
- [ ] Delete this plan in its own commit. Write the brief (skill `pr-brief`; no screenshots, backend only, with the rulings listed). Mark the PR ready with no `preview` label (backend-only), then run the code rounds.

## Size

About 350 changed lines without tests and migrations: domain ~110, server ~170, functions and views ~70.
