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
5. An active template's chip reads **"Platí"** (new label) in the `confirmed` (green) colour, as in the GTasks mockup, so it doesn't read as a takeable task; a proposed one uses the existing `proposed` chip ("Návrh").
7. On Úkoly, templates are a section **below** the one-time list (UX nit: rows that need action stay on top). Tabs as in the mockup can come with #38, when the list grows.
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
- Produces: tables `templates`, `templateScoreApprovals`; `TEMPLATE_STATUSES = ['proposed', 'active'] as const` (schema comment: stored `active` = the domain's `TemplateAgreement` status `agreed`; `agreementOf` maps between them); types `TemplateRow`, `TemplateStatus`.

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
- Modify: `src/lib/taskLimits.ts` (move `normaliseTitle(title: string): string | null` here from `src/server/tasks/tasks.ts`, which then imports it; behaviour unchanged), `src/server/users/hooks.ts` (add `resolveProposedTemplates`)
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
  - `createTemplate`: giver creates → `proposed`, one approval row (the giver), `template.created` audited; the stored schedule/deadline round-trips through `listTemplates`: `days: [0, 3, 6]`, `time: '18:30'`, `deadline: { dayOffset: 1, due: '07:45', graceMinutes: 90 }` (Sunday, Saturday and non-zero minutes survive the bitmask and `HH:MM` helpers); a second template with `schedule: null, deadline: null` reads back as `schedule: null, deadline: null` (stored mask 0); a third with `time: null` reads back `time: null`.
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
- Validator `parseNewTemplate(data: unknown): NewTemplate` (exported for the test): checks types only (strings, safe integers, booleans, arrays, objects or null) and throws `Invalid input`; `schedule.days` longer than 7 entries also throws (so an oversized array is refused before it is de-duplicated); ranges are the domain's job.

- [ ] **Step 1: failing tests:** `parseNewTemplate` accepts a full valid body and `schedule: null, deadline: null`; throws on a string score, `days: '2'`, `days` with 8 entries, a missing `deadline` key, extra nesting garbage. Guards test gets the four new entries (fails until the functions exist).
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
- Produces: `describeTemplate(t: Pick<TemplateView, 'schedule' | 'deadline'>): string` and `templateDetail(t: Pick<TemplateView, 'schedule' | 'deadline' | 'approvalRequired' | 'approvedBy' | 'status'>): string` = summary + ` · ` + `schvaluje rodič` / `bez schvalování`, and for proposed ones + ` · Souhlasí: Táta`.

Exact copy (strings.ts, `templates`): `kindOneTime: 'Jednorázový'`, `kindRecurring: 'Opakovaný'`, `section: 'Opakované'`, `empty: 'Zatím žádné opakované úkoly.'`, `when: 'Kdy vzniká'`, `days: ['Ne','Po','Út','St','Čt','Pá','So']` (index = Weekday), `atTime: 'V čase'`, `withTime: 'V určitý čas'`, `noTimeHint: 'Bez času vznikne o půlnoci.'`, `onDemandHint: 'Bez vybraného dne vzniká jen na požádání.'`, `approvalOn: 'schvaluje rodič'`, `approvalOff: 'bez schvalování'`, `agreedBy: 'Souhlasí'`, `onDemand: 'Jen na požádání'`, `deadline: 'Termín'`, `noDeadline: 'Bez termínu'`, `noDeadlineHint: 'čeká, dokud to někdo neudělá'`, `withDeadline: 'S termínem'`, `withDeadlineHint: 'pak propadne'`, `dueDay: 'Hotovo do'`, `dayOffsets: ['týž den','další den','za 2 dny','za 3 dny','za 4 dny','za 5 dnů','za 6 dnů']`, `dueTime: 'v'`, `grace: 'Zapsat jde ještě'`, `hours: (n) => \`${n} h\``, `proposeHint: 'Začne platit, až cenu schválí jeden z kluků.'`, `created: 'Opakovaný úkol navržen'`, `activeChip: 'Platí'`, `recurringMeta: 'Opakovaný'`, errors `invalidSchedule: 'Vyber aspoň jeden den.'`, `invalidDeadline: 'Termín nedává smysl. Zkontroluj ho.'`, `alreadyApproved: 'Souhlas už máš zapsaný.'`.

Summary format (days Monday first, so `[1, 2]` before `[0]`): `Út, Pá v 18:00 · do dalšího dne 7:00 (+2 h)`; no time: `Út, Pá`; no schedule: `Jen na požádání`; no deadline: no `·` part; `dayOffset` 0: `do 7:00 (+0 h)` reads `do 7:00`, grace 0 omits `(+0 h)`; `dayOffset` ≥ 2: `do 7:00 za 3 dny`. Hours with no leading zero (`7:00`), minutes always two digits.

- [ ] **Step 1: failing tests** for each summary case above (exact strings), for `templateDetail` (approval on → `… · schvaluje rodič`; off → `… · bez schvalování`; proposed with Táta approved → ends `· Souhlasí: Táta`; active → no `Souhlasí`), and for the three new error messages.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS (`src/lib/strings.test.ts` too).
- [ ] **Step 5:** commit `Templates: Czech labels and schedule summary`.

### Task 6: Nový úkol: the recurring half (GCreate)

**Files:**
- Create: `src/components/tasks/ScoreField.tsx` (the − / dial / + / quick picks block moved out of `novy.tsx`, unchanged behaviour), `src/components/templates/RecurringFields.tsx`, `src/components/templates/actions.ts`
- Modify: `src/routes/_app/ukoly/novy.tsx`
- Test: `src/components/templates/RecurringFields.test.tsx`, `src/components/templates/actions.test.ts`, existing `src/components/tasks/tasks.test.tsx` still green

The repo has no DOM test setup (Vitest `environment: 'node'`, component tests use `renderToStaticMarkup`), and this PR adds no dependency. So: what a button sends lives in pure functions that take the server function as a parameter (default = the real one) and are tested with a fake; rendering is tested with `renderToStaticMarkup` for given props.

**Interfaces:**
- Produces:
  - `ScoreField({ value, onChange }: { value: number; onChange: (n: number) => void })`;
  - `RecurringFields({ value, onChange }: { value: RecurringValue; onChange: (v: RecurringValue) => void })` with `RecurringValue = { days: Weekday[]; withTime: boolean; time: string; hasDeadline: boolean; dayOffset: number; dueTime: string; graceHours: number }`. Defaults: `days: []`, `withTime: true`, `time: '18:00'`, `hasDeadline: false`, `dayOffset: 1`, `dueTime: '07:00'`, `graceHours: 2`;
  - `toDefinition(v: RecurringValue): Pick<NewTemplate, 'schedule' | 'deadline'>` (pure, in `actions.ts`);
  - `submitNewItem(kind: 'one_time' | 'recurring', form: { title: string; score: number; approvalRequired: boolean; recurring: RecurringValue }, fns?: { createTask: typeof createTaskFn; createTemplate: typeof createTemplateFn }): Promise<{ ok: true; id: number } | { ok: false; error: string }>`;
  - `approveTemplate(t: Pick<TemplateView, 'id' | 'score'>, fn?: typeof approveTemplateScoreFn)` (used by Task 7).

Layout (mockup GCreate): a two-button switch at the top (`Jednorázový` / `Opakovaný`, `aria-pressed`, each `min-h-tap`); name card + ScoreField + approval checkbox shared by both; for Opakovaný a second card:
- seven day toggles Po…Ne (`size-tap` round buttons, `aria-pressed`) in a `grid-cols-7` row that breaks out of the card padding (`-mx-2`, `gap-px`), so all seven fit on one line at 360 px (316 px available, 308 needed);
- with no day picked: the time controls are hidden and the hint `onDemandHint` shows under the days, so "on demand" is a visible state;
- with a day picked: a checkbox `V určitý čas` (default on) and, when on, `<input type="time">`; when off, the hint `noTimeHint`;
- the two deadline option buttons; with a deadline: a Select for the day offset, a time input for the due time, and a − / + stepper for grace hours (0–48).

Submit → `submitNewItem`; busy state on the button, Czech error under the form with `role="alert"`, the form stays filled so a retry is one tap. The hint under the button switches to `templates.proposeHint`.

- [ ] **Step 1: failing tests:**
  - `toDefinition`: no days → `schedule: null` (time ignored); `days: [0, 6]`, `time: '18:30'` → `{ days: [0, 6], time: { hour: 18, minute: 30 } }`; `withTime: false` → `time: null`; deadline off → `deadline: null`; on with `dueTime: '07:45'`, `graceHours: 2` → `{ dayOffset: 1, due: { hour: 7, minute: 45 }, graceMinutes: 120 }`.
  - `submitNewItem` with fake fns: `recurring` calls only `createTemplate` with `{ data: { title, score, approvalRequired, ...toDefinition(form.recurring) } }`; `one_time` calls only `createTask` with `{ data: { title, score, approvalRequired } }`; a refused result is passed through.
  - `approveTemplate` with a fake fn sends `{ data: { templateId: 7, score: 4 } }`.
  - `approveTemplate` result handling: a pure `approveOutcome(result: { ok: true } | { ok: false; error: string } | 'threw'): { toast: 'success' | 'error'; message: string }` returns `templates.approved`-style success or the Czech `taskErrorMessage` text / `cs.login.failed`; tested for ok, `not_proposed` and a thrown call. `WaitingForYou` uses it and always clears its busy id in `finally`.
  - Rendering (`renderToStaticMarkup`): `days: [2]` → the `Út` button has `aria-pressed="true"`, the others `false`; `days: []` → the onDemand hint shows and no `type="time"` input for the schedule; deadline inputs only with `hasDeadline: true`; the grace − button is `disabled` at 0, + at 48.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS; `pnpm typecheck`.
- [ ] **Step 5:** commit `Nový úkol: recurring templates (GCreate)`.

### Task 7: Úkoly list and "Čeká na tebe"

**Files:**
- Modify:
  - `src/components/tasks/TaskRow.tsx` + `StateChip.tsx`: optional `stateLabel?: string` (overrides the chip text) and optional `detail?: ReactNode`, a line under the meta line that **wraps** (no truncation), for template rows;
  - `src/routes/_app/ukoly/index.tsx`: loader also calls `listTemplatesFn`; under the one-time list a `SectionLabel` "Opakované" with template rows (`templates.empty` when there are none; the page's `+ Nový` link stays in the header);
  - `src/components/tasks/WaitingForYou.tsx`: new prop `templates: readonly TemplateView[]`; template rows have meta `Opakovaný` and `detail` = `templateDetail(t)`, button `Souhlasím` → `approveTemplate(t)` (Task 6); section count = tasks + templates;
  - `src/routes/_app/index.tsx`: loader adds `listPendingTemplateApprovalsFn`.
- Test: `src/components/tasks/tasks.test.tsx` (extend)

Rows: proposed → state `proposed`, meta `Čeká na souhlas`, detail = `templateDetail` (summary + approval flag + who agreed); active → state `confirmed` with `stateLabel` `Platí`, detail = `templateDetail`. Long name: two lines then clamp (TaskRow as today); detail wraps fully; points and button stay whole.

- [ ] **Step 1: failing tests** (`renderToStaticMarkup`): `WaitingForYou` with one task and one template shows `Čeká na tebe (2)` and the template's full detail text (Review Focus 4 summary, not cut in the markup); renders nothing with both empty; `TaskRow` with `stateLabel="Platí"` shows that text in the chip, and `detail` renders in an element without `truncate`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** commit `Úkoly and Domů: show and approve templates`.

### Task 8: Demo data and full check

**Files:**
- Modify: `src/server/demo/seed.ts` (inside the seeding transaction: Táta proposes "Vynést koše" 4 b, Tue 18:00, due next day 7:00, grace 2 h, left proposed; and "Vyndat myčku" 3 b, no schedule, no deadline, approved by Starší so it is active; via `createTemplate` / `approveTemplateScore`'s transaction-taking internals or by calling them after the users exist in the same transaction — the seed must stay all-or-nothing)
- Test: `src/server/demo/seed.test.ts` (extend: two templates, statuses `proposed` and `active`; the all-or-nothing test still passes)

- [ ] **Step 1:** failing seed test. **Step 2:** FAIL. **Step 3:** implement; if `createTemplate` opens its own transaction, split it into `createTemplateIn(tx, …)` used by both (same for approve). **Step 4:** PASS.
- [ ] **Step 5:** full gate: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm db:check && pnpm build` all pass.
- [ ] **Step 6:** run once through the real entry point: `TASKMASTER_ENV=preview pnpm dev` on a fresh `DATA_DIR`, log in as `tata`, create a recurring template; log in as `starsi`, see it in "Čeká na tebe", approve; Úkoly shows it as `Platí`.
- [ ] **Step 7:** commit `Demo data: two templates`.
