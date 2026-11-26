# Descriptions on tasks and chores, screens: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parents write and change a task's or chore's description; brothers read it, and OK or turn down a waiting change; everything behind the `descriptions` switch. Also fix long names cut by "Hotovo bez bodů" on Úkoly.

**Architecture:** One shared component folder `src/components/descriptions/` (text block, edit sheet, waiting-change card, calls) used by the task page and the chore page. Nový úkol gets a text field. Taker yes/bid/pick calls carry the text the page showed; the server requires it while the switch is on. The server half is PR #252 (this PR is stacked on it).

**Tech Stack:** React 19, TanStack Start/Router, vaul Drawer, Tailwind, vitest static render, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §4 Description, §5.1 "Description of a template", §5.2 "Description of a one-time task", §5.3 Description. UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` (silent on descriptions; patterns from §7 task page and the dispute sheet).

**Issue:** closes [#207 Add a description to tasks and chores](https://github.com/SlatinskyJ/taskmaster/issues/207), [#176](https://github.com/SlatinskyJ/taskmaster/issues/176), [#180](https://github.com/SlatinskyJ/taskmaster/issues/180), [#194](https://github.com/SlatinskyJ/taskmaster/issues/194) (one bug: long names cut by Hotovo bez bodů on Úkoly).

## Global Constraints

- Up to 1000 characters, line breaks kept, no formatting (§4). Shown as plain text (`whitespace-pre-line break-words`), never as HTML.
- Not on list rows (issue #207); a row only shows a small icon that a description exists.
- Every taker sees the new text before he agrees or bids (§5.2).
- Czech text only in `src/lib/strings.ts`; tap targets ≥ 44 px (`min-h-tap`, `size-tap`); `motion-reduce:` on any transition; busy state, Czech error and retry on every call.
- Switch `descriptions` off → every screen as today, byte for byte where tests already pin it.

## Rulings

1. **Domů yes on a described item** (Jakub's card, pending; built on the recommended option, "Open the page first"): on Domů "Čeká na tebe", a proposed task or chore with a description shows the page link `cs.description.readAndAgree` ("Přečíst a souhlasit") instead of Souhlasím. Without a description the row is unchanged. If Jakub picks another option, this task changes before the code rounds.
2. **Required `seenDescription`** (planned in #252): with the switch on, the six taker handlers (`approveTaskOfferHandler`, `placeBidHandler`, `acceptOfferHandler`, `approveTemplateScoreHandler`, `bidTemplateScoreHandler`, `acceptTemplateOfferHandler`) return `offer_changed` when the field is missing. A page loaded before the deploy gets the "changed, look again" message once.
3. **Error text.** `cs.tasks.errors.offerChanged` says only price; it becomes "Úkol se mezitím změnil. Podívej se znovu." so it fits a changed text too.
4. **Who sees edit.** Upravit popis / Přidat popis: an active giver, on a one-time task that is proposed, open or reserved, and on any chore. Never on an instance (its text is the chore's) nor for a brother.
5. **Chore history.** The chore page has no audit history today; description lines show only in a task's history. The chore page shows the waiting change card like the task page.

## Review Focus

1. **A 1000-character text with many line breaks** on a 360 px page: wraps, nothing cut, the page scrolls.
2. **The keyboard over the edit sheet:** the textarea stays above the keyboard (Drawer).
3. **A stale page:** Táta changes the text while a brother's page is open; his Souhlasím gets the "changed" message and the page reloads to the new text.
4. **Switch off:** no field on Nový úkol, no block on the pages, rows and calls as today.
5. **Long Czech names on Úkoly** ("Umýt okna v obýváku i v ložnici") stay whole next to the new Hotovo bez bodů icon button.

---

### Task 1: Calls, strings, errors

**Files:** Create `src/components/descriptions/descriptionCalls.ts`, `descriptionCalls.test.ts`. Modify `src/lib/strings.ts` (new `cs.description`, reworded `offerChanged`, `cs.history` lines), `src/lib/taskErrors.ts`.

**Produces:**
```ts
export function sendDescription(target: DescriptionTarget, text: string, fn = changeDescriptionFn): Promise<string | null> // null = ok, else Czech message; a throw → cs.login.failed
export function answerDescription(target: DescriptionTarget, changeId: number, yes: boolean, fn = answerDescriptionFn): Promise<string | null>
```
`cs.description`: `label` "Popis", `none` "Bez popisu", `add` "Přidat popis", `edit` "Upravit popis", `sheetTitle`, `field` "Co znamená hotovo", `count(n)` "n / 1000", `save` "Uložit", `waitingTitle` "Nový popis čeká na souhlas", `waitingRemove` "Návrh: popis odebrat", `waitingFor(names)`, `agree` "Souhlasím s popisem", `decline` "Nesouhlasím", `saved`/`waits`/`agreed`/`declined`/`withdrawn` toasts, `hasIcon` "Má popis", `readAndAgree` "Přečíst a souhlasit", `newHint` (Nový úkol help line).
`taskErrorMessage` maps `description_too_long`, `description_frozen`, `not_changeable`, `same_description`, `no_change`, `not_involved` to messages in `cs.description.errors`.

- [ ] Test: `sendDescription` maps `{ok:true}` → null, each error code → its message, a throw → `cs.login.failed`; the fn gets `{data:{kind,id,description}}`. Same for `answerDescription` with `{changeId, yes}`.
- [ ] Implement, run `pnpm vitest run src/components/descriptions src/lib`, commit.

### Task 2: Description block and edit sheet

**Files:** Create `src/components/descriptions/DescriptionBlock.tsx`, `DescriptionSheet.tsx`, `DescriptionForm.tsx` (hook-free, like `DisputeForm`), `descriptionBlock.test.tsx`.

**Produces:** `DescriptionBlock({ text, change, target, canEdit, me })`: `SectionLabel` "Popis" + text (`whitespace-pre-line break-words`) or `cs.description.none` (only when `canEdit`; nothing at all when no text and no edit); a ghost `min-h-tap` button Upravit / Přidat opening `DescriptionSheet`; below, `WaitingDescription` card when `change` is set.
`DescriptionSheet`: vaul Drawer, `DescriptionForm` with `Textarea name="description" maxLength={1000}` pre-filled with the waiting text if any else the text in force, a live `count`, Uložit `size="lg"` busy + `aria-busy`, error `role="alert"`, text kept on error; on success close, toast by outcome (applied → saved, waiting → waits, withdrawn → withdrawn), `router.invalidate()`.
`WaitingDescription({ change, me, names })`: title, the new text (or `waitingRemove`), "Čeká na: …"; for a brother in `change.waitingFor`: Souhlasím s popisem (`ok`) and Nesouhlasím (`ghost`), each busy while sending, toast, invalidate.

- [ ] Tests (static render): text with `\n` keeps the line breaks class and escapes `<b>`; giver sees Upravit, brother does not; no text + giver → Přidat; no text + brother → nothing; the waiting card shows the new text and the two buttons only for a brother in `waitingFor`; a removal shows `waitingRemove`; the form disables Uložit while busy and shows the error; count reads "12 / 1000".
- [ ] Implement, run, commit.

### Task 3: Pages and Nový úkol

**Files:** Modify `src/routes/_app/ukol/$taskId.tsx`, `src/routes/_app/sablona/$templateId.tsx`, `src/routes/_app/ukoly/novy.tsx`, `src/components/templates/actions.ts` (`submitNewItem` sends `description` when non-blank), tests `taskPage.test.tsx`, `templatePage.test.tsx`, `tasksPages.test.tsx` (or the Nový úkol test that exists).

- Task page: `DescriptionBlock` in the first Card under the state line, with `canEdit` per ruling 4; chore page the same in its Card (target `template`). Both only when `features.descriptions`.
- Nový úkol: with the switch on, a Textarea "Popis (nepovinné)" under the name, `maxLength=1000`, count, `cs.description.newHint`.
- [ ] Tests: switch off → no "Popis" on either page and no field on Nový úkol (existing tests unchanged); switch on → the text, Upravit for Táta, nothing to edit for a brother; an instance's page shows its text without Upravit; a done task shows text without Upravit; `submitNewItem` sends `description` only when non-blank.
- [ ] Implement, run, commit.

### Task 4: Taker calls carry the text; the server requires it

**Files:** Modify `src/components/tasks/taskView.ts` (BidCall data of approveOffer, acceptOffer, placeBid gets `seenDescription: task.description`), `src/components/templates/priceView.ts` (approve, acceptOffer, bid data), `src/components/templates/actions.ts` (`approveTemplate` sends `seenDescription: t.description`), `src/server/tasks/functions.ts`, `src/server/templates/functions.ts` (ruling 2), `src/lib/strings.ts` (ruling 3); tests `taskView.test.ts`, `priceView.test.ts`, `actions.test.ts`, `src/server/descriptions/functions.test.ts`.

- [ ] Tests: each builder's data carries `seenDescription` equal to the view's text (null when none); the six handlers with the switch on and no field → `offer_changed`; with the field → as before; switch off and no field → ok.
- [ ] Implement, run `pnpm vitest run src/components src/server/descriptions`, commit.

### Task 5: Domů, rows, history

**Files:** Modify `src/components/tasks/WaitingForYou.tsx` (ruling 1), `src/components/tasks/TaskRow.tsx` (optional `described?: boolean` → a `NotebookText` icon, `aria-label={cs.description.hasIcon}`, `size-4`, after the name inside the name line), callers `TakerBoard.tsx`, `TaskGroups.tsx`, `RecurringList.tsx`/`TemplateRow.tsx` pass `described={t.description !== null}`; `src/components/tasks/historyText.ts` (six `task.description_*` lines); `src/server/settlement/meeting.ts:139` passes the switch (#252 review nit); tests `homePage.test.tsx`, `taskRow.test.tsx`, `historyText.test.ts`.

- [ ] Tests: a row with `described` has one icon with the label, without it the row renders byte-for-byte as before; Domů: a proposed task with text → link "Přečíst a souhlasit" to `/ukol/<id>` and no Souhlasím; without text → Souhlasím as today; the same for a proposed chore; history: each action's Czech line with who.
- [ ] Implement, run, commit.

### Task 6: Úkoly Hotovo bez bodů as an icon (#176, #180, #194)

**Files:** Modify `src/routes/_app/ukoly/index.tsx` (the open row's action: `Button size="icon" variant="ghost"` with `CircleCheckBig`, `aria-label` and `title` = `cs.work.doneSelf`, same confirm Dialog), `src/components/tasks/ukolyPage.test.tsx`.

- [ ] Tests: the open row's button has `aria-label="Hotovo bez bodů"` and no visible label text; the Dialog opens as before (existing tests keep passing); the reserved row keeps its labelled Uvolnit.
- [ ] Implement, run, commit.

### Task 7: Server follow-ups from #252 review

**Files:** `src/domain/description.ts` and its test (bidi range written `‪-‮⁦-⁩`), `src/server/descriptions/descriptions.test.ts`.

- [ ] Tests: cancel discards a waiting change (`closedBy` = Táta); the scheduler's expiry discards it with `closedBy` null and a system actor; rollback cases for withdrawn, applied on release and discarded on completion (`failAuditOn` the description action; the step rolls back too).
- [ ] Run, commit.

### Task 8: Seed, e2e, keyboard, finish

**Files:** `src/server/demo/pieces.ts` (piece `descriptions`: "Umýt auto" proposed with a two-line text; "Vynést věci na půdu" open with a waiting change by Táta; chore "Vyndat myčku" agreed with a text), `seeds.ts` (`demo` gets the piece; new seed `descriptions` with `features: ['descriptions', 'openRows']`), `e2e/suites.ts` (rows `descriptions`, `keyboard-descriptions`), `e2e/descriptions.spec.ts`, `e2e/keyboard-descriptions.spec.ts`.

- [ ] e2e: Táta creates a task with a text → Starší's Domů shows the icon and "Přečíst a souhlasit" → the page shows the text → Souhlasím → open. Táta edits the open task → "Nový popis čeká na souhlas" → Mladší OKs → the text changes and the history line shows. A no keeps the old text. A long name on Úkoly is whole (bounding box of the name inside the row, no ellipsis).
- [ ] Keyboard: Nový úkol's description field and the edit sheet's textarea stay above the keyboard.
- [ ] `pnpm test && pnpm typecheck && pnpm lint && pnpm build`; e2e in CI.
- [ ] Screenshots at 360×800 for the UX judge (both roles, long names, keyboard open) and 393×852 for the brief. Delete the plan, brief, ready with `preview`, code rounds.

## Size

About 600 changed lines without tests: components ~260, pages and form ~90, call data and handlers ~60, Domů/rows/history ~90, seed ~50, strings ~50. Over 400: it is the one screen set for one feature behind one switch; splitting the edit from the read would ship pages that show a text nobody can change.
