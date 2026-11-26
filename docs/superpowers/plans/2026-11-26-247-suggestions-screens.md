# Suggestions: screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The screens of [#247 Suggest app improvements from Profil](https://github.com/SlatinskyJ/taskmaster/issues/247): a Navrhnout zlepšení sheet and Moje návrhy on Profil, a Návrhy section on Správa with Hotovo / Zamítnout / Poslat na GitHub, the demo piece and the e2e suites. Closes #247.

**Architecture:** Stacked on PR #287 (server half: `createSuggestionFn`, `listMySuggestionsFn`, `getAdminSuggestionsFn`, `closeSuggestionFn`, `sendSuggestionFn` in `src/server/suggestions/functions.ts`, rules in `src/domain/suggestions.ts`). Form and outcome logic in plain modules (unit-tested); components render static markup in tests; interactions in e2e. Two bottom sheets (vaul `Drawer`, moves above the keyboard) for the forms; a centred `Dialog` only for the no-text confirm of Hotovo / Zamítnout.

**Size:** about 450 changed lines (not counting tests, e2e and generated files). One PR: Profil and Správa share the strings, the state chip and the demo seed; splitting would leave a Správa list with nothing to review on a preview.

**Tech Stack:** React, TanStack Router loaders, shadcn `Drawer` / `Dialog` / `Input` / `Textarea`, Tailwind tokens, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.13, §7; UI doc `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §7.4, §7.5.

## Global Constraints

- Everything behind `features.suggestions`; with it off Profil and Správa look exactly as today (the `launch` e2e suite stays green unchanged).
- Czech text only in `src/lib/strings.ts`, under a new `cs.suggestions` block.
- Title 1–120, description up to 2,000 (counted by the server; the inputs set `maxLength` 120 / 2000 as a guard; the server's code-point count is the rule).
- The send preview is filled by `issueDraft` (no author's name), editable, and states that the issue is public.
- Forms on a phone: the typed-in field is visible with the keyboard open (CLAUDE.md); each form gets a case in an e2e keyboard spec.
- Tap targets ≥ 44 px (`min-h-tap`); every transition has `motion-reduce:`; every request has a busy state and a Czech error with a way to retry; every loader has empty and error states; Hotovo and Zamítnout (final) ask first in a Dialog.

## Rulings (mine, for the brief)

1. **Who sees what:** Profil's section for every role (taker, giver, admin). Správa's section for the admin only (Správa already is admin-only).
2. **Send without a token:** the row's Poslat na GitHub always opens the preview; inside, the send button is disabled and a note says the server has no GitHub token (so the preview can be checked on a PR preview and in e2e).
3. **Issue made, not saved** (`sent_not_saved`): the sheet stays open and shows an alert with the issue link and "Neposílej ho znovu, označ návrh jako hotový."; the list reloads.
4. **Count of new:** the Správa section label reads `Návrhy · 2 nové` (Czech plural via a function in strings, as `t.title(n)` in disputes).
5. **Moje návrhy** shows the state as a chip and, once sent, a link `Na GitHubu` (opens in a new tab, `rel="noopener noreferrer"`).
6. **Long text:** titles and descriptions wrap (`break-words`), never cut; descriptions keep line breaks (`whitespace-pre-line`). At 360 px a row is: chip + time on the first line, title below, description below, buttons in a wrapping row.

## Review Focus

1. A title of only spaces → the sheet refuses before sending (`Napiš název.`), no request. (Task 1 unit test.)
2. The server says `feature_off` (switch flipped off while the sheet is open) → Czech error, sheet stays. (Task 1 unit test.)
3. Double tap on Odeslat → one request (e2e counts `createSuggestionFn` POSTs on a double click); Poslat's server side is covered by #287's `busy` test. (Task 5 e2e.)
4. Loader request fails → section shows the error with Zkusit znovu, the rest of Profil/Správa still renders. (Task 2 and 4 component tests.)
5. A 120-character title and a 2,000-character description render whole at 360 px. (Task 6 screenshots, Task 2/4 component tests assert no `truncate`.)

---

### Task 1: Strings and form logic

**Files:**
- Modify: `src/lib/strings.ts` (block `suggestions`)
- Create: `src/components/suggestions/suggestionForms.ts`, `src/components/suggestions/suggestionForms.test.ts`

**Interfaces:**
- Produces in `cs.suggestions`: `section: 'Nápady na zlepšení'`, `row: 'Navrhnout zlepšení'`, `sheetTitle: 'Navrhnout zlepšení'`, `titleLabel: 'Název'`, `descriptionLabel: 'Popis (nepovinné)'`, `note: 'Návrh uvidí správce aplikace.'`, `send: 'Odeslat'`, `sending: 'Odesílám…'`, `sent: 'Návrh je odeslaný. Díky!'`, `mine: 'Moje návrhy'`, `mineEmpty: 'Zatím žádný návrh.'`, `status: { new: 'Nový', sent: 'Na GitHubu', done: 'Hotovo', dismissed: 'Zamítnutý' }`, `issueLink: 'Na GitHubu'`, `adminTitle: (newCount: number) => string` (`'Návrhy'` for 0, else `'Návrhy · 1 nový'`, `'· 2–4 nové'`, `'· 5+ nových'`), `adminEmpty: 'Žádné návrhy.'`, `done: 'Hotovo'`, `dismiss: 'Zamítnout'`, `confirmDone: 'Označit návrh jako hotový?'`, `confirmDismiss: 'Zamítnout návrh?'`, `confirmFinal: 'Tohle už nejde vrátit.'`, `cancel: 'Zpět'`, `sendRow: 'Poslat na GitHub'`, `previewTitle: 'Poslat na GitHub'`, `issueTitleLabel: 'Název issue'`, `issueBodyLabel: 'Text issue'`, `publicNote: 'Issue bude veřejné. Zkontroluj, že v textu nejsou jména.'`, `noToken: 'Server nemá GitHub token, poslat teď nejde.'`, `sendIssue: 'Poslat na GitHub'`, `sentToast: 'Návrh je na GitHubu.'`, `notSaved: 'Issue na GitHubu vzniklo, ale aplikace si ho neuložila. Neposílej ho znovu, označ návrh jako hotový.'`, `loadError: 'Návrhy se nepodařilo načíst.'`, `retry: 'Zkusit znovu'`, `errors: { title_empty: 'Napiš název.', title_too_long: 'Název je moc dlouhý (nejvýš 120 znaků).', description_too_long: 'Popis je moc dlouhý (nejvýš 2000 znaků).', body_too_long: 'Text je moc dlouhý (nejvýš 4000 znaků).', not_found: 'Návrh už neexistuje.', not_admin: 'Tohle může jen správce.', not_new: 'Návrh už byl odeslaný.', closed: 'Návrh je už vyřízený.', busy: 'Návrh se právě odesílá, chvilku počkej.', no_token: <noToken>, github_failed: 'GitHub teď neodpovídá. Zkus to znovu.', feature_off: 'Návrhy jsou teď vypnuté.', generic: 'Nepodařilo se to odeslat. Zkus to znovu.' }`, `stale: 'Návrh se mezitím změnil, seznam je obnovený.'`.
- Produces in `suggestionForms.ts`:
  - `checkSuggestion(v: { title: string }): string | null` (empty after trim → `errors.title_empty`)
  - The calls take the server function and its input and catch a thrown request (offline, 500) as `errors.generic`, like `sendDispute` / `sendDismiss` in `src/components/disputes/disputeCalls.ts`:
  - `sendNewSuggestion(call, input: { title: string; description: string }): Promise<string | null>` (null = done, else the Czech message)
  - `sendClose(call, input: { id: number; move: 'done' | 'dismiss' }): Promise<AdminOutcome>` (reuses `AdminOutcome` from `disputeCalls.ts`; `not_found`, `closed`, `not_new` are stale → `{ ok: false, message: stale, reload: true }`)
  - `sendIssue(call, input: { id: number; title: string; body: string }): Promise<AdminOutcome | { ok: false; notSaved: true; url: string }>` (stale codes as above; `sent_not_saved` → `{ ok: false, notSaved: true, url }`)
  - `issueInput(item: AdminSuggestion, edited: { title: string; body: string }): { id: number; title: string; body: string }` (the request body from the admin's **edited** fields, never `issueDraft` again)
  - Each error map is a `Record<ServerError, string>`, so a new server error fails the typecheck until it has text.
  - `adminTitle` plural is tested here: 0, 1, 2, 4, 5, 21.

- [ ] **Step 1: Write the failing tests**: `checkSuggestion({ title: ' \n ' })` → `cs.suggestions.errors.title_empty`, `{ title: 'a' }` → null; each call maps every error code (one `it.each` per function over the codes) and ok; a call that throws → `errors.generic` with `reload: false`; stale codes → `reload: true` and `stale`; `issueInput(item, { title: 'Edited', body: 'Edited body' })` → `{ id: item.id, title: 'Edited', body: 'Edited body' }` while `issueDraft(item)` differs; `sendIssue` with a call answering `{ ok: false, error: 'sent_not_saved', url: U }` → `{ ok: false, notSaved: true, url: U }`; `adminTitle(0)` `'Návrhy'`, `(1)` `'Návrhy · 1 nový'`, `(2)` and `(4)` `'· N nové'`, `(5)` and `(21)` `'· N nových'`.
- [ ] **Step 2:** `pnpm test src/components/suggestions` → FAIL. **Step 3:** implement. **Step 4:** PASS, `pnpm test src/lib/strings.test.ts` PASS. **Commit** `Suggestions: Czech text and form logic`.

### Task 2: Profil: sheet and Moje návrhy

**Files:**
- Create: `src/components/suggestions/SuggestDrawer.tsx` (Drawer + form, keyed by `open` so it starts empty), `src/components/suggestions/MySuggestions.tsx` (pure list), `src/components/suggestions/ProfileSuggestions.tsx` (section: row button, drawer, list), `src/components/suggestions/StatusChip.tsx`, `src/components/suggestions/suggestions.test.tsx`
- Modify: `src/routes/_app/profil.tsx` (loader adds `loadMine(() => listMySuggestionsFn())`, catches a throw as `{ error: 'load' }`; renders `<ProfileSuggestions enabled={features.suggestions} data={...} />` after `ProfilePassword`)

**Interfaces:**
- `type MineData = MySuggestion[] | { error: 'feature_off' } | { error: 'load' }`; `loadMine(call): Promise<MineData>` exported from `ProfileSuggestions.tsx`.
- `StatusChip({ status }: { status: SuggestionStatus })`: chip with `cs.suggestions.status[status]`, colours `state-open` (new), `state-pending` (sent), `state-confirmed` (done), `state-cancelled` (dismissed).
- Sheet: Název `Input` (`maxLength` 120, `autoFocus`, `enterKeyHint="next"`, Return moves to Popis), Popis `Textarea` (`maxLength` 2000, `max-h-48 overflow-y-auto`), `note`, submit `Button size="lg"` with `aria-busy`, disabled while busy; error `role="alert"`; on done: close, `toast.success(sent)`, `router.invalidate()`.
- Row button: `min-h-tap`, full-width, like ProfilePassword's row.

- [ ] **Step 1: Write the failing component tests** (static markup): with `enabled` false → renders nothing; `{ error: 'feature_off' }` → nothing; `{ error: 'load' }` → `loadError` + `retry` button; `[]` → `mineEmpty`; a list → each title, chip text, newest first as given, a sent one has an `<a href=issueUrl target="_blank" rel="noopener noreferrer">` with `issueLink`; a 120-character title appears whole and no element has class `truncate`; description keeps line breaks (`whitespace-pre-line`). `loadMine` with a throwing call → `{ error: 'load' }`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Commit** `Suggestions: Profil sheet and my list`.

### Task 3: Správa: Návrhy section

**Files:**
- Create: `src/components/admin/SuggestionsCard.tsx` (pure list), `src/components/admin/CloseSuggestionDialog.tsx` (Dialog: question, `confirmFinal`, Zpět / confirm, busy state), `src/components/admin/SendSuggestionDrawer.tsx` (preview form), `src/components/admin/suggestionsCard.test.tsx`
- Modify: `src/routes/_app/sprava.tsx` (loader adds `loadAdminSuggestions(() => getAdminSuggestionsFn())`; section rendered after Sporné, before Opravy bodů; state for the open dialog/drawer)

**Interfaces:**
- `type AdminSuggestionsData = { items: AdminSuggestion[]; canSend: boolean } | { error: 'feature_off' } | { error: 'load' }`, `loadAdminSuggestions(call)`.
- `SuggestionsCard({ data, onClose, onSend, onRetry })`: takes the whole `AdminSuggestionsData`; `{ error: 'feature_off' }` renders nothing (tested here, so Správa with the switch off shows no Návrhy text). Label `cs.suggestions.adminTitle(count of status 'new')`. Each row: `Avatar` + author name, `formatPragueDate(createdAt)`, `StatusChip`, title, description, link when sent; buttons: new → Hotovo, Zamítnout, Poslat na GitHub; sent → Hotovo; done/dismissed → none. Buttons `min-h-tap`, in a `flex flex-wrap gap-2` row.
- `onClose(item, move: 'done' | 'dismiss')` opens the Dialog; confirm calls `sendClose(closeSuggestionFn, { id, move })`; ok: toast, close, invalidate; `reload: true`: close, `toast.error(message)`, invalidate; other error: alert in the dialog, dialog stays (retry).
- `SendSuggestionDrawer({ item, canSend, open, onOpenChange, onDone })`: fields filled from `issueDraft(item)` (keyed by item id + open); `publicNote`; when `!canSend` the `noToken` note and the button disabled; send → `sendIssue(sendSuggestionFn, issueInput(item, fields))`; ok: toast `sentToast`, close, invalidate; `reload: true`: close, toast.error, invalidate; `notSaved`: alert with the text and a link to the url, button disabled, list invalidated; other error: alert, stays (retry).

- [ ] **Step 1: Write the failing component tests:** `loadAdminSuggestions` with a throwing call → `{ error: 'load' }`, with `feature_off` passes it through; card with `{ error: 'feature_off' }` → empty markup; label with 2 new, 1 sent and 1 done → `Návrhy · 2 nové`; a new row shows the three buttons, a sent row only Hotovo and the link, a done row no buttons; author name shown; `{ error: 'load' }` → error + retry; `{ items: [] }` → `adminEmpty`; send drawer markup with `canSend: false` shows `noToken` and a disabled button; with `canSend: true` the button is **enabled**, no `noToken`, and the fields hold `issueDraft` text and no author name (author "Kuba" absent from the markup of the fields); the `notSaved` state shows the link and a disabled button. Dialog markup with an error shows the alert and both buttons.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Commit** `Suggestions: Správa section`.

### Task 4: Demo piece and seed

**Files:**
- Modify: `src/server/demo/pieces.ts` (piece `suggestions`), `src/server/demo/seeds.ts` (add to `demo`; new seed `suggestions: { pieces: [suggestions], features: ['suggestions'] }`), `src/server/demo/seed.test.ts`

**Interfaces:**
- Piece uses `createSuggestionIn` and `closeSuggestionIn` (real actions, `step(...)`): starší "Tmavý režim i na obrazovce Týden" (new, two-line description); mladší "Zvuk, když dokončím úkol" (new, no description); Táta "Připomenout v neděli schůzku" (done by admin); starší "Víc bodů za vynesení koše" (dismissed by admin). Note: no sent one (that needs GitHub).

- [ ] **Step 1:** failing test in `seed.test.ts`: the `suggestions` seed leaves 4 rows with states new, new, done, dismissed and the switch on; `demo` includes them.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS. **Commit** `Suggestions: demo piece and seed`.

### Task 5: E2E

**Files:**
- Create: `e2e/suggestions.spec.ts`, `e2e/keyboard-suggestions.spec.ts`
- Modify: `e2e/suites.ts` (rows `{ name: 'suggestions', spec: 'suggestions.spec.ts', seed: 'suggestions' }` (its own server: writes) and `{ name: 'keyboard-suggestions', spec: 'keyboard-suggestions.spec.ts', seed: 'suggestions' }` (read-only)), `e2e/keyboard.spec.ts` only if the suite convention requires a line there (follow `keyboard-password`)

- [ ] **Step 1: Write the specs.** `suggestions.spec.ts`: (a) `mladsi` on Profil sends "Delší přestávka mezi úkoly" with a description; the button shows busy; toast; Moje návrhy lists it as Nový above "Zvuk, když dokončím úkol"; he does not see starší's. (b) `admin` on Správa: label `Návrhy · 3 nové`; marks mladší's new one Hotovo (dialog, confirm) → chip Hotovo, label `· 2 nové`; Zamítnout on another → Zamítnutý; Poslat na GitHub on the last new one opens the preview with the title and without the author's name, the send button disabled and `noToken` shown (no token on e2e servers). (c) A title of spaces: Odeslat shows `Napiš název.` and no request goes out. (d) A double click on Odeslat with a valid title → exactly one POST to the create function (count `page.on('request')` matching its URL) and one new row in Moje návrhy. `keyboard-suggestions.spec.ts`: Profil sheet, Název and Popis each `openKeyboard` + `expectAboveKeyboard`; Správa send sheet, Název issue and Text issue the same.
- [ ] **Step 2:** `pnpm exec playwright test e2e/suggestions.spec.ts e2e/keyboard-suggestions.spec.ts` → FAIL before Tasks 2–4 are wired, PASS after. **Step 3: Commit** `Suggestions: e2e and keyboard cases`.

### Task 6: Verify and screenshots

- [ ] `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build`, then the two new e2e suites and `launch` → pass.
- [ ] Screenshots (brief + UX judge, one set, `pr-review-rounds` §1): iPhone 15 Pro 393×852 @3, light, `demo` seed. Files: `profil-taker-section.png`, `profil-taker-sheet.png`, `profil-taker-keyboard-title.png`, `profil-taker-keyboard-description.png`, `profil-taker-error.png` (empty title), `sprava-admin-list.png`, `sprava-admin-list-360.png` (360×800), `sprava-admin-confirm.png`, `sprava-admin-send.png`, `sprava-admin-send-notoken.png`, `sprava-admin-keyboard-issue-title.png`, `sprava-admin-keyboard-issue-body.png`, `profil-taker-list-360.png`. One demo suggestion gets a 120-character title for the 360 shots (seeded in the screenshot script, not in the piece).
