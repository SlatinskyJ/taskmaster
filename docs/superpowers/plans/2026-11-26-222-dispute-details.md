# Open a Sporné item on Správa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#222 Open a Sporné item on Správa to see its details](https://github.com/SlatinskyJ/taskmaster/issues/222)

**Goal:** On Správa → Sporné, tapping a dispute card opens the disputed task or chore on its real page, read-only for the admin.

**Architecture:** The admin's dispute list gains a `page` link target per entry (server, from the loaded target). The card's body becomes a stretched link (the #205 row pattern); Ponechat and Opravit sit above it. The task page and the chore page, and their two read functions, admit the admin; every action on those pages is already gated on giver/taker, and the loaders skip the dispute marks for the admin. Behind the `disputes` switch like the rest of the card.

**Tech Stack:** TanStack Start/Router, SQLite/Drizzle, vitest static render, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.11 (disputes: the admin decides open disputes), UI doc §7.5 ADisputes. Jakub's decision (2026-11-26, project thread): "the admin opens the real task and chore pages read-only, not a detail sheet on Správa".

**Size:** about 150 changed lines outside tests.

## Global Constraints

- Czech UI text only in `src/lib/strings.ts`; code and identifiers in English.
- No rule change: the admin is no party (spec §5.11). The admin reads; every write stays giver/taker only on the server (unchanged middlewares on every write function).
- Behind the `disputes` launch switch: with it off Správa has no Sporné card, so no link exists.
- Screens may import only `~/server/<module>/functions` (ESLint).
- 44 px taps (`min-h-tap`), `motion-reduce:` on any transition.

## Decisions (plan rulings)

1. **Which items link.** `task_score`, `completion`, `rejection` → `/ukol/$taskId` (a rejection through its rejection's `taskId`); `template_score` → `/sablona/$templateId`. `settlement` and `adjustment` have no page an admin can open today (Týden is per viewer; an adjustment has no page): their card stays as it is, no link. A `follow-up` issue tracks "a settlement's week view for the admin", linked in the brief. (The issue lets the plan decide.)
2. **Read-only means no actions, not a separate mode.** The pages already show actions only to a giver or taker who may act; the admin matches none. The plan adds no `readOnly` prop; tests pin that an admin render has no button but ← (and no Rozporovat).
3. **No dispute marks for the admin.** The loaders call `getItemMarkFn` (giver/taker only) only for a giver or taker, so the admin's page loads; Rozporovat is a party's action.
4. **Admin's back goes to Správa.** `back="history"` already goes back in app history; a cold page's fallback is Domů, which redirects the admin to Správa (`guardScreen`). No change.
5. **A missing item** (deleted target, `page: null`) gives no link, so no 404 from Správa.

## Review Focus

- A Ponechat or Opravit tap must not open the page (buttons above the stretched link).
- The admin must never get a working write: every action button absent, and the server write functions still refuse the admin (existing guards test).
- A proposed chore for the admin: `getTemplateDetail` must not return null for the admin (today it does for anyone but giver/taker).
- The card at 360 px with a long title still wraps (no cut) after becoming a link.
- With the `disputes` switch off nothing changes (no card).

---

### Task 1: The admin's list says where each item opens

**Files:**
- Modify: `src/server/disputes/list.ts` (`AdminDisputeEntry`, `describe`, `listOpenForAdmin`)
- Modify: `src/server/disputes/targets.ts` (`ItemAbout` gains `page`)
- Test: `src/server/disputes/list.test.ts`

**Interfaces:**
- Produces: `export type ItemPage = { kind: 'task' | 'template'; id: number }`; `AdminDisputeEntry.page: ItemPage | null` (re-exported from `~/server/disputes/functions`).

- [ ] **Step 1: Failing test** in `list.test.ts`, "admin list: each entry's page (#222)": open one dispute of each kind on the existing fixtures; assert `listOpenForAdmin(db).map(e => [e.item.kind, e.page])` equals task_score → `{kind:'task', id: <task>}`, completion → same task, rejection → `{kind:'task', id: <rejected task>}` (not the audit entry id), template_score → `{kind:'template', id}`, settlement → `null`, adjustment → `null`. A dispute whose task row is gone → `page: null`.
- [ ] **Step 2:** run `pnpm vitest run src/server/disputes/list.test.ts`, expect FAIL (`page` undefined).
- [ ] **Step 3:** `loadTarget`'s `about` gains `page: ItemPage | null` per kind (rejection: `r.taskId`); `describe` copies it into the admin entry only (`DisputeListEntry` for takers/givers unchanged).
- [ ] **Step 4:** run again, expect PASS; the shape pin of `adminDisputesHandler` in `functions.test.ts` updated with `page`.
- [ ] **Step 5:** commit.

### Task 2: The admin may read the task and chore pages

**Files:**
- Modify: `src/lib/nav.ts` (`SCREEN_ROLES['/ukol/$taskId']`, `['/sablona/$templateId']` gain `'admin'`)
- Modify: `src/server/tasks/functions.ts` (`getTaskDetailFn` middleware `requireRole('giver','taker','admin')`)
- Modify: `src/server/templates/functions.ts` (`getTemplateDetailFn` the same) and `src/server/templates/templates.ts` (`getTemplateDetail`: admin allowed, sees a proposed chore)
- Modify: `src/routes/_app/ukol/$taskId.tsx`, `src/routes/_app/sablona/$templateId.tsx` (marks only when `context.user.role !== 'admin'`)
- Test: `src/lib/nav.test.ts`, `tests/server-fn-guards.test.ts`, `src/server/templates/templates.test.ts`, `src/components/tasks/taskPage.test.tsx`, `src/components/templates/templatePage.test.tsx`

- [ ] **Step 1: Failing tests.**
  - nav: `canSee('admin', '/ukol/$taskId')` and `'/sablona/$templateId'` true; every other admin row unchanged (the matrix test).
  - guards: the two read functions list `admin` among allowed roles; every write function in the guards table still refuses `admin` (existing rows, unchanged).
  - templates: `getTemplateDetail(db, proposedId, adminId)` and `(activeId, adminId)` return the detail.
  - pages: render the task page (open, reserved, done-unconfirmed, confirmed) and the chore page (proposed, active, with a price change) with `me = {role:'admin'}`: the only `<button`/link-button is ← ; no Rezervovat, Hotovo, Souhlasím, Schválit, Zrušit, Změnit cenu, Rozporovat; the history list is there.
- [ ] **Step 2:** run them, expect FAIL.
- [ ] **Step 3:** make the changes above. If a page shows an action to the admin, gate that component on `me.role !== 'admin'` (record which in the brief).
- [ ] **Step 4:** run, expect PASS; `pnpm typecheck`.
- [ ] **Step 5:** commit.

### Task 3: Tapping a Sporné card opens its page

**Files:**
- Modify: `src/components/admin/DisputesCard.tsx`
- Modify: `src/lib/strings.ts` (`cs.admin.disputes.openFor(what, name)`: "Otevřít: {what} – {name}", the link's accessible name)
- Test: `src/components/admin/disputesCard.test.tsx`

- [ ] **Step 1: Failing test:** an entry with `page: {kind:'task', id: 7}` renders one `<a href="/ukol/7"` stretched over the card (`after:absolute after:inset-0`) whose name is the `what` line; the buttons sit in a `relative z-10` wrapper; `{kind:'template', id: 4}` → `/sablona/4`; `page: null` renders no `<a` and the card markup exactly as before (byte pin of today's markup).
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3:** `li` gets `relative`; the `what` line becomes a `Link` with the #205 stretched-link classes (`focus-visible` ring on the card, `active:after:bg-current/5`, `motion-reduce:` not needed: no transition); the button row wraps in `relative z-10`.
- [ ] **Step 4:** run, expect PASS.
- [ ] **Step 5:** commit.

### Task 4: e2e, screenshots

**Files:**
- Modify: `e2e/disputes.spec.ts` (or the admin spec that opens Sporné; it already has open disputes on its seed)

- [ ] **Step 1:** e2e: admin on Správa taps a task dispute card → `/ukol/<id>`, heading is the task, no Rezervovat/Hotovo/Rozporovat buttons, ← goes back to Správa; taps a chore dispute → `/sablona/<id>`; Ponechat on a card opens the dialog and stays on Správa.
- [ ] **Step 2:** run the suite, expect PASS; full `pnpm test && pnpm typecheck && pnpm lint && pnpm build`.
- [ ] **Step 3:** screenshots (360×800 for UX, 393×852 for the brief): Správa Sporné with a long title, the task page and the chore page as admin.
- [ ] **Step 4:** commit.
