# Recurring templates: create and agree — Implementation Plan

> **For agentic workers:** build with superpowers:executing-plans (CLAUDE.md PR flow step 3), tests first. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#37 Recurring templates with score agreement](https://github.com/SlatinskyJ/taskmaster/issues/37). The score *change* flow was split out to [#138 Template score change](https://github.com/SlatinskyJ/taskmaster/issues/138) (stacked on this PR later).

**Goal:** a giver creates a recurring template (name, score, approval flag, schedule, deadline rule); it stays *proposed* until score agreement (one giver + one taker), then becomes *active*. Every step audit-logged.

**Architecture:** the agreement rules already exist in `src/domain/agreement.ts` (`proposeTemplate`, `approveTemplate`, `resolveTemplate`). This PR adds a small domain module that validates the template's definition (schedule, deadline rule), a `templates` table with its approvals table, a server module that mirrors `src/server/tasks/tasks.ts` (load rows → ask the domain → write rows + audit in one transaction), four server functions, and the UI: the "Opakovaný" half of Nový úkol, an "Opakované" list on Úkoly, and template approvals in "Čeká na tebe".

**Tech Stack:** TanStack Start, Drizzle + better-sqlite3, Vitest, Tailwind v4 + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §3 (score agreement), §4, §5.1, §5.3 (schedule, deadline mode, approval flag), §5.5 (default on), §5.10. UI: `2026-11-16-taskmaster-ui-design.md` §5, §6, §7 (GCreate, GTasks, TApprove).

**Size:** about 650 changed lines without tests, migration and generated files. Over the 400 goal because it is one vertical slice: the form, the agreement and the approval card only make sense together on a preview, and the score change (the other half of the issue) already moved to #138. Under 800.

## Global Constraints

- UI labels Czech, only in `src/lib/strings.ts`. Code, identifiers, DB, logs English.
- Scores are whole numbers from 1 (`isValidScore`).
- Score agreement = at least one active giver and one active taker approved; proposing counts as approving; the admin never counts; approvals checked live (spec §3).
- Only givers create templates (spec §5.1). Until agreed, a template is *proposed* and creates no instances.
- Approval-required flag default **on** (spec §5.5 [call]).
- Every state change writes its audit entry in the same transaction (`writeAudit(tx, …)`).
- Domain data is never deleted (spec §5.10). New tables get a Drizzle migration (`pnpm db:generate --name templates`); never edit a committed one.
- Prague wall clock only through `src/domain/dates.ts`; instants stored UTC (`toIsoUtc`). `Weekday` is 0 = Sunday … 6 = Saturday.
- Every tap target ≥ 44 px (`min-h-tap`, `size-tap`).

## Jakub's decision (2026-11-18, project thread)

The spec says a template has "a due time" but not how it is set. Jakub chose **day + time after the instance appears**: "next day, 7:00" means bins that appear Tue 18:00 are due Wed 7:00 Prague time; if that moment has already passed when the instance appears (a late "+ Teď"), it moves a day later. This PR stores and validates the rule; computing actual due times is #38/#39. The spec gets one sentence in §5.3 via a separate spec PR (CLAUDE.md: never fix the spec inside a feature PR).

## Builder [call]s (go into the PR brief)

1. A schedule needs at least one weekday; its time is optional. No time = the instance appears at the start of that Prague day (00:00). (Spec: "the days (and optionally a time)". When an instance actually appears is #39's job; this PR stores and shows it.)
2. Deadline rule A: `dayOffset` 0–6 days after the instance appears, at `due` HH:MM; grace 0–48 h, picked in whole hours in the UI, stored in minutes.
3. A template may have a deadline without a schedule (on-demand only, #38).
4. No "Nesouhlasím" button for a proposed template (the mockup's TApprove has one): the spec has no refusal for templates; one taker's yes agrees it, and a taker who dislikes the score bids a change once it is active (#138).
5. An active template's chip reads **"Platí"** (new label) in the `open` colour; a proposed one uses the existing `proposed` chip ("Návrh").
6. Editing other fields and cancelling a template are not in the spec's rules for #37; left out (audit actions `template.updated` / `template.cancelled` stay unused).

## Review Focus

1. **A taker approves a template whose proposing giver was deactivated meanwhile** → still proposed (no current giver approved); another giver's yes agrees it. Test in Task 3 (live approvals).
2. **A taker approves after the page went stale** (the template got agreed by his brother a second earlier) → refused `not_proposed`, nothing written, Czech "už je vyřízený" message. Test in Task 3.
3. **Schedule time without days, deadline half-filled, `dayOffset` 7, grace 49 h, time "24:00"** sent straight to the server function → refused `invalid_schedule` / `invalid_deadline`, nothing written; the DB CHECKs back it up. Tests in Tasks 1, 2, 3.
4. **Long Czech template name and a busy schedule summary at 360 px** ("Vyluxovat celý obývák a chodbu", "Po, Út, St, Čt, Pá, So, Ne v 18:00 · do dalšího dne 7:00 (+2 h)") → name wraps to two lines then clamps, the meta line truncates, points and button stay whole (TaskRow already does this). Screenshot in the code phase.
5. **Two people approve at the same moment** → one `template.agreed` entry, the status changes once (the update runs only while `status = 'proposed'` inside the transaction; better-sqlite3 transactions are serialised). Test in Task 3 (second approval after agreement → `not_proposed`).

---

### Task 1: Domain: template definition

**Files:**
- Create: `src/domain/templates.ts`
- Modify: `src/domain/index.ts` (export it), `src/domain/README.md` (one bullet)
- Test: `src/domain/templates.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ClockTime { hour: number; minute: number }          // 0–23, 0–59
  export interface TemplateSchedule { days: readonly Weekday[]; time: ClockTime | null }
  export interface DeadlineRule { dayOffset: number; due: ClockTime; graceMinutes: number }
  export interface TemplateDefinition { schedule: TemplateSchedule | null; deadline: DeadlineRule | null }
  export type TemplateDefinitionError = 'invalid_schedule' | 'invalid_deadline'
  export const MAX_DUE_DAY_OFFSET = 6
  export const MAX_GRACE_MINUTES = 2880 // 48 h
  export function validateTemplateDefinition(def: TemplateDefinition): Result<TemplateDefinition, TemplateDefinitionError>
  ```
  The returned definition has `days` sorted ascending and de-duplicated.

- [ ] **Step 1: Write the failing tests** (`describe('validateTemplateDefinition (spec §5.3)')`):
  - accepts `{ schedule: null, deadline: null }` (on demand, no deadline) unchanged;
  - accepts `{ days: [2, 2, 5], time: { hour: 18, minute: 0 } }` → `days: [2, 5]`; and `time: null`;
  - `invalid_schedule` for `days: []`, a day `7`, `-1`, `1.5`, time `{ 24, 0 }`, `{ 18, 60 }`, `{ 18.5, 0 }`;
  - deadline boundaries: `dayOffset` 0 and 6 ok, 7 and −1 `invalid_deadline`; `graceMinutes` 0 and 2880 ok, 2881 and −1 `invalid_deadline`; `due` `{ 23, 59 }` ok, `{ 24, 0 }` `invalid_deadline`;
  - a deadline without a schedule is accepted ([call] 3).
- [ ] **Step 2:** `pnpm vitest run src/domain/templates.test.ts` → FAIL (module missing).
- [ ] **Step 3:** implement; integers checked with `Number.isInteger`.
- [ ] **Step 4:** same command → PASS. `pnpm lint` (domain boundary rule) clean.
- [ ] **Step 5:** commit `Domain: validate a template's schedule and deadline rule`.

### Task 2: Schema and migration

**Files:**
- Create: `src/server/db/schema/templates.ts`, `drizzle/0008_templates.sql` (+ meta, generated)
- Modify: `src/server/db/schema/index.ts`
- Test: `src/server/db/templates-schema.test.ts`

**Interfaces:**
- Produces: tables `templates`, `templateScoreApprovals`; `TEMPLATE_STATUSES = ['proposed', 'active'] as const`; types `TemplateRow`, `TemplateStatus`.

`templates` columns: `id` pk autoincrement; `title` text not null; `status` text enum not null; `score` integer not null (the proposed score while proposed, the agreed score after); `approval_required` boolean not null; `schedule_days` integer not null default 0 (bit `1 << weekday`, 0 = no schedule); `schedule_time` text null (`HH:MM`); `due_day_offset` integer null; `due_time` text null (`HH:MM`); `grace_minutes` integer null; `created_by` → users not null; `created_at`, `updated_at` not null; `agreed_at` null.
CHECKs: status in the list; `score >= 1`; `length(trim(title)) > 0`; `schedule_days BETWEEN 0 AND 127`; `schedule_time IS NULL OR schedule_days > 0`; deadline all-or-none (`(due_day_offset IS NULL) = (due_time IS NULL) AND (due_time IS NULL) = (grace_minutes IS NULL)`); `due_day_offset BETWEEN 0 AND 6`; `grace_minutes BETWEEN 0 AND 2880`. Index on `status`.

`template_score_approvals`: `template_id` → templates, `user_id` → users, `score`, `approved_at`; primary key (`template_id`, `user_id`). Append-only; a proposed template's score never changes, so no offer round (change rounds get their own table in #138).

- [ ] **Step 1: failing tests** on `createTestDb()`: a valid row inserts; each CHECK rejects one bad row (time without days, half deadline, offset 7, grace 2881, days 128, score 0, blank title); a second approval row for the same (template, user) is rejected.
- [ ] **Step 2:** run → FAIL (no table).
- [ ] **Step 3:** write the schema; `pnpm db:generate --name templates`; `pnpm db:check` passes.
- [ ] **Step 4:** tests PASS.
- [ ] **Step 5:** commit `DB: templates and template score approvals`.

### Task 3: Server: create, approve, resolve, read

**Files:**
- Create: `src/server/templates/templates.ts`, `src/server/templates/index.ts`
- Modify: `src/server/tasks/tasks.ts` (export the existing `normaliseTitle`), `src/server/users/hooks.ts` (add `resolveProposedTemplates`)
- Test: `src/server/templates/templates.test.ts`

**Interfaces:**
- Consumes: `proposeTemplate`, `approveTemplate`, `resolveTemplate`, `missingRoles`, `isValidScore` (`~/domain`), Task 1, Task 2.
- Produces:
  ```ts
  export interface NewTemplate { title: string; score: number; approvalRequired: boolean; schedule: TemplateSchedule | null; deadline: DeadlineRule | null }
  export type TemplateError = AgreementError | TemplateDefinitionError | 'invalid_title' | 'not_found'
  export function createTemplate(db: Db, giverId: number, input: NewTemplate, now?: Date): Result<TemplateRow, TemplateError>
  export function approveTemplateScore(db: Db, userId: number, templateId: number, score: number, now?: Date): Result<TemplateRow, TemplateError>
  export function resolveProposedTemplates(tx: Tx, people: Person[], now: Date): void
  export interface TemplateView {
    id: number; title: string; status: TemplateStatus; score: number; approvalRequired: boolean
    createdByName: string; approvedBy: string[]            // proposed only, oldest first
    schedule: { days: Weekday[]; time: string | null } | null   // time "HH:MM"
    deadline: { dayOffset: number; due: string; graceMinutes: number } | null
  }
  export function listTemplates(db: Db | Tx): TemplateView[]                       // newest first
  export function pendingTemplateApprovals(db: Db | Tx, userId: number): TemplateView[]
  ```
  Storage helpers (module-private): weekday list ↔ bitmask, `ClockTime` ↔ `"HH:MM"`.

Audit entries (entity `template`): `template.created` (after: the row), `template.score_approved` (after `{ score }`), `template.agreed` (before `{ status: 'proposed' }`, after `{ status: 'active', score }`). `resolveProposedTemplates` logs `template.agreed` as `{ kind: 'system' }`.

- [ ] **Step 1: failing tests**, same `family()` helper shape as `tasks.test.ts`:
  - `createTemplate`: giver creates → `proposed`, one approval row (the giver), `template.created` audited; the stored schedule/deadline round-trips through `listTemplates` (`days: [2]`, `time: '18:00'`, `deadline: { dayOffset: 1, due: '07:00', graceMinutes: 120 }`).
  - wrong actors: taker and admin → `not_a_giver`, nothing written.
  - `invalid_title` (blank, 81 chars), `invalid_score` (0, 1.5), `invalid_schedule`, `invalid_deadline` → nothing written.
  - `approveTemplateScore`: a taker's yes → `active`, `agreedAt` set, entries `template.score_approved` + `template.agreed` with the before/after above.
  - a second giver's yes alone keeps it proposed; the admin → `not_a_party`.
  - stale: score not the stored one → `offer_changed`; already active → `not_proposed`; unknown id → `not_found`; same person twice → `already_approved`. Nothing written in each.
  - live approvals: proposing giver deactivated (`updateUser`) → a taker's yes leaves it `proposed`; then another giver's yes → `active`.
  - rollback: a trigger that aborts `template.agreed` inserts → approval row and status unchanged, only `template.created` in the log.
  - `resolveProposedTemplates`: through the real hook path (`updateUser` that turns a recorded approver into a taker) → `active`, logged as system.
  - `pendingTemplateApprovals`: a taker sees a new proposed template; after his own yes he doesn't; the giver sees it only when no current giver has approved; the admin and an inactive user get `[]`.
  - `TemplateView` shape pinned with `toEqual` (no `createdBy` id, no extra fields).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement, mirroring `createTask` / `approveTaskOffer` / `resolveProposedTasks` / `pendingApprovals` in `src/server/tasks/tasks.ts`. The status update is `UPDATE … WHERE id = ? AND status = 'proposed'`.
- [ ] **Step 4:** PASS; `pnpm vitest run src/server` all green (hooks list change).
- [ ] **Step 5:** commit `Templates: create, agree and list (spec §5.1)`.

### Task 4: Server functions

**Files:**
- Create: `src/server/templates/functions.ts`
- Modify: `tests/server-fn-guards.test.ts` (`EXPECTED_ROLES`)
- Test: `src/server/templates/functions.test.ts`

**Interfaces:**
- Produces: `createTemplateFn` (giver), `approveTemplateScoreFn` (giver, taker; data `{ templateId, score }`), `listTemplatesFn` (giver), `listPendingTemplateApprovalsFn` (giver, taker). Results `{ ok: true; id: number } | { ok: false; error: TemplateError }`, like `TaskActionResult`.
- Validator `parseNewTemplate(data: unknown): NewTemplate` (exported for the test): checks types only (strings, safe integers, booleans, arrays, objects or null) and throws `Invalid input`; ranges are the domain's job.

- [ ] **Step 1: failing tests:** `parseNewTemplate` accepts a full valid body and `schedule: null, deadline: null`; throws on a string score, `days: '2'`, a missing `deadline` key, extra nesting garbage. Guards test gets the four new entries (fails until the functions exist).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement with `requireRole`, as in `src/server/tasks/functions.ts`.
- [ ] **Step 4:** `pnpm vitest run src/server/templates tests/server-fn-guards.test.ts` → PASS.
- [ ] **Step 5:** commit `Templates: server functions`.

### Task 5: Czech text and the schedule summary

**Files:**
- Modify: `src/lib/strings.ts` (new `templates` block, `state` gets no new key; `templates.activeChip: 'Platí'`), `src/lib/taskErrors.ts` (`invalid_schedule`, `invalid_deadline`, `already_approved` messages)
- Create: `src/lib/templateText.ts`
- Test: `src/lib/templateText.test.ts`, `src/lib/taskErrors.test.ts`

**Interfaces:**
- Produces: `describeTemplate(t: Pick<TemplateView, 'schedule' | 'deadline'>): string`.

Exact copy (strings.ts, `templates`): `kindOneTime: 'Jednorázový'`, `kindRecurring: 'Opakovaný'`, `section: 'Opakované'`, `empty: 'Zatím žádné opakované úkoly.'`, `when: 'Kdy vzniká'`, `days: ['Ne','Po','Út','St','Čt','Pá','So']` (index = Weekday), `atTime: 'V čase'`, `noTimeHint: 'Bez času vznikne hned ráno.'`, `onDemand: 'Jen na požádání'`, `deadline: 'Termín'`, `noDeadline: 'Bez termínu'`, `noDeadlineHint: 'čeká, dokud to někdo neudělá'`, `withDeadline: 'S termínem'`, `withDeadlineHint: 'pak propadne'`, `dueDay: 'Hotovo do'`, `dayOffsets: ['týž den','další den','za 2 dny','za 3 dny','za 4 dny','za 5 dnů','za 6 dnů']`, `dueTime: 'v'`, `grace: 'Zapsat jde ještě'`, `hours: (n) => \`${n} h\``, `proposeHint: 'Začne platit, až cenu schválí jeden z kluků.'`, `created: 'Opakovaný úkol navržen'`, `activeChip: 'Platí'`, `recurringMeta: 'Opakovaný'`, errors `invalidSchedule: 'Vyber aspoň jeden den.'`, `invalidDeadline: 'Termín nedává smysl. Zkontroluj ho.'`, `alreadyApproved: 'Už jsi souhlasil.'`.

Summary format (days Monday first, so `[1, 2]` before `[0]`): `Út, Pá v 18:00 · do dalšího dne 7:00 (+2 h)`; no time: `Út, Pá`; no schedule: `Jen na požádání`; no deadline: no `·` part; `dayOffset` 0: `do 7:00 (+0 h)` reads `do 7:00`, grace 0 omits `(+0 h)`; `dayOffset` ≥ 2: `do 7:00 za 3 dny`. Hours with no leading zero (`7:00`), minutes always two digits.

- [ ] **Step 1: failing tests** for each summary case above (exact strings) and for the three new error messages.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS (`src/lib/strings.test.ts` too).
- [ ] **Step 5:** commit `Templates: Czech labels and schedule summary`.

### Task 6: Nový úkol: the recurring half (GCreate)

**Files:**
- Create: `src/components/tasks/ScoreField.tsx` (the − / dial / + / quick picks block moved out of `novy.tsx`, unchanged behaviour), `src/components/templates/RecurringFields.tsx`
- Modify: `src/routes/_app/ukoly/novy.tsx`
- Test: `src/components/templates/RecurringFields.test.tsx`, existing `src/components/tasks/tasks.test.tsx` still green

**Interfaces:**
- Produces: `ScoreField({ value, onChange }: { value: number; onChange: (n: number) => void })`; `RecurringFields({ value, onChange }: { value: RecurringValue; onChange: (v: RecurringValue) => void })` with `RecurringValue = { days: Weekday[]; time: string /* "" = none */; hasDeadline: boolean; dayOffset: number; dueTime: string; graceHours: number }` and `toDefinition(v: RecurringValue): Pick<NewTemplate, 'schedule' | 'deadline'>` (exported, pure). Defaults: `days: []`, `time: '18:00'`, `hasDeadline: false`, `dayOffset: 1`, `dueTime: '07:00'`, `graceHours: 2`.

Layout (mockup GCreate): a two-button switch at the top (`Jednorázový` / `Opakovaný`, `aria-pressed`, each `min-h-tap`); name card + ScoreField + approval checkbox shared by both; for Opakovaný a second card: seven day toggles Po…Ne (`size-tap` round buttons, `aria-pressed`, wrap at 360 px), `<input type="time">` labelled `V čase` with the hint, the two deadline option buttons, and with a deadline: a Select for the day offset, a time input for the due time, and a − / + stepper for grace hours (0–48). Submit → `createTemplateFn` for Opakovaný, `createTaskFn` otherwise; busy state on the button, Czech error under the form with `role="alert"`, the form stays filled so a retry is one tap. The hint under the button switches to `templates.proposeHint`.

- [ ] **Step 1: failing tests** (Testing Library, as in `tasks.test.tsx`): `toDefinition` with no days → `schedule: null`; days + empty time → `time: null`; deadline off → `deadline: null`; on → `{ dayOffset: 1, due: { hour: 7, minute: 0 }, graceMinutes: 120 }`. Rendering: tapping `Út` sets `aria-pressed="true"` and calls `onChange` with `days: [2]`; the deadline fields appear only after `S termínem`; the grace − button is disabled at 0, + at 48.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS; `pnpm typecheck`.
- [ ] **Step 5:** commit `Nový úkol: recurring templates (GCreate)`.

### Task 7: Úkoly list and "Čeká na tebe"

**Files:**
- Modify: `src/routes/_app/ukoly/index.tsx` (loader also calls `listTemplatesFn`; a `SectionLabel` "Opakované" with template rows above the one-time list; the existing empty state stays for one-time tasks, the templates section gets `templates.empty` with the `+ Nový` link only when both lists are empty), `src/components/tasks/TaskRow.tsx` + `StateChip.tsx` (optional `stateLabel?: string` that overrides the chip text), `src/components/tasks/WaitingForYou.tsx` (new prop `templates: readonly TemplateView[]`; rows with meta `Opakovaný · <describeTemplate>` and `Souhlasím` → `approveTemplateScoreFn({ templateId, score })`; section count = tasks + templates), `src/routes/_app/index.tsx` (loader adds `listPendingTemplateApprovalsFn`)
- Test: `src/components/tasks/tasks.test.tsx` (extend)

- [ ] **Step 1: failing tests:** `WaitingForYou` with one task and one template shows `Čeká na tebe (2)` and the template's summary; it renders nothing with both empty; `TaskRow` with `stateLabel="Platí"` shows that text in the chip; a failed approve shows the Czech toast and re-enables the buttons.
- [ ] **Step 2:** FAIL. **Step 3:** implement (rows: proposed → state `proposed`, meta `Čeká na souhlas`; active → state `open` with `stateLabel` `Platí`, meta = summary). **Step 4:** PASS.
- [ ] **Step 5:** commit `Úkoly and Domů: show and approve templates`.

### Task 8: Demo data and full check

**Files:**
- Modify: `src/server/demo/seed.ts` (inside the seeding transaction: Táta proposes "Vynést koše" 4 b, Tue 18:00, due next day 7:00, grace 2 h, left proposed; and "Vyndat myčku" 3 b, no schedule, no deadline, approved by Starší so it is active; via `createTemplate` / `approveTemplateScore`'s transaction-taking internals or by calling them after the users exist in the same transaction — the seed must stay all-or-nothing)
- Test: `src/server/demo/seed.test.ts` (extend: two templates, statuses `proposed` and `active`; the all-or-nothing test still passes)

- [ ] **Step 1:** failing seed test. **Step 2:** FAIL. **Step 3:** implement; if `createTemplate` opens its own transaction, split it into `createTemplateIn(tx, …)` used by both (same for approve). **Step 4:** PASS.
- [ ] **Step 5:** full gate: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm db:check && pnpm build` all pass.
- [ ] **Step 6:** run once through the real entry point: `TASKMASTER_ENV=preview pnpm dev` on a fresh `DATA_DIR`, log in as `tata`, create a recurring template; log in as `starsi`, see it in "Čeká na tebe", approve; Úkoly shows it as `Platí`.
- [ ] **Step 7:** commit `Demo data: two templates`.
