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

Rulings 1 and 7 are open questions to Jakub (decision cards in the project thread). The plan builds the recommended answer; the other answer changes only the step named in the ruling.

1. **Back to proposed** (asked Jakub; if he picks "apply", `discardStaleDescription` applies the text instead and logs `task.description_changed`). A release of a bid-won reservation sends the task back to `proposed` (§5.4). A change waiting at that moment is **discarded**, and the old text stays. The giver can change it again at once, since a proposed task needs nobody's OK.
2. **Completed, cancelled or expired** (any status other than proposed, open or reserved): a waiting change is discarded, logged as `*.description_change_discarded`.
3. **Reserved ↔ open while a change waits** (release, reserve): the change stays. Who may OK it follows the task's state at the moment of the answer.
4. **Instances** are not changeable (`not_changeable`). Their text is a copy from creation.
5. **Changing back.** A giver who sets the text that is in force while a change waits closes that change as `withdrawn`, and nothing else changes. With no change waiting, the same text is `same_description`.
6. **Normalising.** `\r\n` and `\r` become `\n`, and the whole text is trimmed. Empty means no description (`null`). The length is counted after normalising, in UTF-16 code units (`String.length`, like the 1000-character limits elsewhere). Control characters other than `\n` and `\t` (U+0000–U+001F, U+007F) are removed first.
7. **A change while proposed resets the agreement** (asked Jakub; recommended). The description is what done means, so yeses and bids given on the old text must not count. A change to a proposed task or template (applied at once) also closes every open bid and starts a new offer round at the same score, with the changing giver as the offerer. For a task that is `closeRows` + `newOfferRound` in `src/server/tasks/bidding.ts`, as `turnDownBids` does; for a template, the same steps as `turnDownTemplateBidsIn` in `src/server/templates/scoreChange.ts`. One audit entry, `*.description_changed`, with `offerRound` and the closed `entryIds` in `before`/`after`. If Jakub picks "keep", these two calls go and the entry loses those keys.
8. **Stale page on a proposed task or chore.** Every taker sees the new text before he agrees or bids (§5.2). So a taker's yes, pick or bid carries `seenDescription` (the text his page showed, `null` for none). With the switch on, the server compares it with the current description, after normalising, and refuses a mismatch with `offer_changed`. This covers `approveTaskOfferFn`, `acceptOfferFn`, `placeBidFn` and the template yes, accept and bid functions. In this PR the field is optional (a missing field is not checked), so today's screens keep working with the switch on; PR 2 sends it from every one of those screens and makes it required when the switch is on.

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
export function normaliseDescription(raw: string): Result<string | null, 'description_too_long'>
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
  - `normaliseDescription`:
    - `'  a\r\nb\r '` → `ok('a\nb')`;
    - `'   '` → `ok(null)`;
    - `'a'.repeat(1000) + '\r\n'` → ok;
    - `'a'.repeat(1001)` → `fail('description_too_long')`;
    - `'a\u0000b\u0007\tc\u007f'` → `ok('ab\tc')`;
    - `'\u0000'.repeat(5)` → `ok(null)`.
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
    - next equals the waiting text → `same_description`;
    - removal: `next = null` with current `'x'` → direct `'apply'`, any_taker `'wait'`; `next = null` with current `null` → `same_description`;
    - a waiting removal (`pending = null`) and next `null` → `same_description`; next equal to current while the removal waits → `'withdraw'`.
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
  - `src/server/instances/instances.ts:75` (`description: template.description` in `insertInstance`, and `description` in the `born` object, so `instance.created` / `instance.self_logged` entries record it);
  - `src/server/tasks/tasks.ts` and `src/server/tasks/bidding.ts` (`approveTaskOffer`, `acceptOffer`, `placeBid` take an optional `seenDescription?: string | null` and check it per ruling 8);
  - `src/server/templates/templates.ts` and `src/server/templates/scoreChange.ts` (the same for `approveTemplateScore`, the template accept and bid).

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

A template's entries use the `template.*` names and `entityType: 'template'`.

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
  - the change path normalises: `changeDescriptionOf(..., ' y\r\n')` stores (or waits with) `'y'`; 1001 characters → `description_too_long` and nothing is written; `'a'.repeat(1000)` is accepted;
  - removal: on a proposed task `''` clears it to `null`; on an open task a removal waits, and a taker's OK sets `tasks.description` to `null`;
  - template entries: each of applied, waiting, OK, no and withdrawn writes exactly one entry with the `template.*` action and `entityType: 'template'`, `entityId` = the template's id, and no `task.*` entry;
  - instance birth entry: `instance.created` (on demand) and `instance.self_logged` carry `after.description` = the template's text at that moment;
  - ruling 7: a proposed task with Mladší's open bid; a giver changes the text. Then the bid is closed, `offerRound` went up by one, the changing giver's approval is the only one in the new round, and there is one `task.description_changed` entry with the closed `entryIds`. A giver's accept of the lowest bid afterwards → `no_bids`. The same for a proposed template with a bid (when `choreBidding` is on) and with no bid (only `offerRound` moves);
  - ruling 8: `approveTaskOffer(..., seenDescription: 'old')` after a change → `offer_changed` and nothing written; with the current text → ok; with no field → ok; with the switch off the field is ignored. The same for `placeBid`, `acceptOffer` and the template yes and bid;
  - rollback: with `writeAudit` made to throw (the way `src/server/tasks/tasks.test.ts` does it), an applied change, a waiting change, an OK and a no each leave `tasks.description` and `description_changes` unchanged.
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
  - `src/server/templates/functions.ts`;
  - `tests/server-fn-guards.test.ts`: `EXPECTED_ROLES` gains `changeDescriptionFn: 'giver'` and `answerDescriptionFn: 'taker'`;
  - blast radius of the new required view fields (`TaskView.description`, `TemplateView.description`, `TaskDetail.descriptionChange`, `TemplateDetail.descriptionChange`): every hand-built view gets `description: null` (and `descriptionChange: null`). That is `src/components/meeting/fixtures.ts` (not a test file) and the component tests in `src/components/tasks/` and `src/components/templates/` that build a `TaskView` or `TemplateView` (find them with `pnpm typecheck`). The brief names this.
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
- When the switch is off, every `description` and `descriptionChange` reads `null`, so the screens show nothing. The mask sits in the shared builders: `views()` in `src/server/tasks/tasks.ts` and the template view builder in `src/server/templates/templates.ts` take a `descriptions: boolean` option, next to the existing `BiddingOpts` / `settleLastDay` style options. So `listBoard`, `listTasks`, `getTaskDetail`, the meeting screen's lists, `listTemplates` and `getTemplateDetail` all mask. Each server function reads the switch once with `getFlags(db).descriptions` in its own `functions.ts` and passes it in; the default is off.
- `createTaskFn` and `createTemplateFn` validators accept an optional `description` string, and `parseDescriptionChange` a required one. Each takes at most 4000 raw characters before normalising, as the DoS cap. Their handlers return `{ ok: false, error: 'feature_off' }` when it is non-empty and the switch is off.
- The parsers reject a non-integer id, an unknown `kind`, a non-string description and a non-boolean `yes` (throw, like `parseTaskId`).

- [ ] **Step 1: Write the failing tests** in `functions.test.ts`:
  - switch off: both handlers → `feature_off`;
  - switch off: a create with a description → `feature_off`, a create without one → ok;
  - switch off: `getTaskDetail(...).task.description` is null even when the column is set;
  - switch on: a full round trip (change on an open task → `waiting`, a taker's answer `yes` → `agreed`, and the detail shows the text);
  - the parser cases above, plus the cap: 4000 raw characters parse, 4001 throw (for `parseDescriptionChange` and the create parsers);
  - templates: switch off → a template create with a description → `feature_off`; switch on → a 1001-character one → `description_too_long`; `listTemplates` and `getTemplateDetail` mask `description` and `descriptionChange` with the switch off;
  - every masked list: with the switch off, `listBoard` and `listTasks` rows have `description: null` though the column is set;
  - `waitingFor` on a reserved task is exactly `[reserverId]`;
  - shape: `toStrictEqual` on a `TaskDetail.descriptionChange` and on `DescriptionResult`, so no extra field leaks; `waitingFor` holds ids only.
- [ ] **Step 2:** Run `pnpm vitest run src/server/descriptions/functions.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement, following `withdrawBidHandler` / `reopenBiddingHandler` in `src/server/tasks/functions.ts`.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck && pnpm lint`. Expect all to pass.
- [ ] **Step 5:** Commit `Description server functions behind the descriptions switch (#207)`.

### Task 5: Finish

- [ ] Run `pnpm db:check && pnpm build && pnpm e2e --trace off`. All must pass (no screen changes, so no new e2e).
- [ ] Delete this plan in its own commit. Write the brief (skill `pr-brief`; no screenshots, backend only, with the rulings listed). Mark the PR ready with no `preview` label (backend-only), then run the code rounds.

## Size

About 420 changed lines without tests and migrations: domain ~120, server ~200 (with rulings 7 and 8), functions and views ~100. Just over the 400 goal. It stays one PR because the server pieces are one rule set: the waiting change, the proposed-time reset and the stale check all decide when a text counts, and splitting them would ship a switch whose rules are half there. The fixture edits for the new view fields are mechanical (`description: null`).
