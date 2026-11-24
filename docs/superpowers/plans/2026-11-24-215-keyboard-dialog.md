# Keep the focused field visible in dialogs: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** #215 Keep the focused field visible with the phone keyboard open. Builds on PR #214 (merged; `e2e/keyboard.ts`).

**Goal:** A centred `Dialog` with a text field (Nové heslo, Zrušit úkol?) stays inside the part of the screen the phone keyboard leaves, so the field being typed into is visible, also when the dialog focuses it on open.

**Architecture:** One client-side tracker writes the visual viewport's top and height into two CSS variables on `<html>` (`--vv-top`, `--vv-height`) and keeps them current on `visualViewport` `resize`/`scroll`. `DialogContent` centres itself in that box instead of the layout viewport and caps its height to it (scrolling inside when taller). With no keyboard the variables equal the full screen, so nothing moves.

**Tech Stack:** React 19, TanStack Start, Radix Dialog, Tailwind v4, Vitest (node env), Playwright.

**Spec:** issue #215 (Jakub's rule, 2026-11-24: the field a person types into is visible while they type, also when a sheet or dialog focuses it on open; the send button may be under the keyboard if the page scrolls to it). UI doc §5 keeps Dialog for actions that cannot be undone, so the dialogs stay dialogs.

## Global Constraints

- No Czech text changes. No new dependency.
- Shared module (`src/components/ui/dialog.tsx`): every Dialog in the app gets the new position; with no keyboard it must look exactly as before.
- Animations keep `motion-reduce:animate-none`.

## Review Focus

1. Dialog opened with the keyboard already up (Radix focuses the first field on open): the field is visible without a second tap. Pinned by Task 2's e2e cases (they do not call `focus()` themselves).
2. A dialog taller than the space above the keyboard: it scrolls inside, the focused field stays visible. Pinned by the `max-h` + `overflow-y-auto` in Task 2 and the Zrušit úkol case (textarea).
3. Browsers without `window.visualViewport` (old/SSR): the CSS fallbacks (`0px`, `100dvh`) keep today's centring. Pinned by Task 1's "no visualViewport" unit test.
4. Keyboard closes: the dialog returns to the centre. Pinned by Task 1's resize test (values follow every event).
5. Dialogs without a field (Hotovo bez bodů confirm, settle): unchanged with no keyboard. Covered by existing e2e suites that open them.

Size: about 40 changed lines outside tests.

---

### Task 1: Visual viewport tracker

**Files:**
- Create: `src/lib/visualViewport.ts`
- Test: `src/lib/visualViewport.test.ts`
- Modify: `src/routes/__root.tsx` (the existing `useEffect` in `RootDocument`)

**Interfaces:**
- Produces: `trackVisualViewport(win: Pick<Window, 'visualViewport'> & { document: { documentElement: { style: Pick<CSSStyleDeclaration, 'setProperty'> } } }): () => void` — writes `--vv-top: <offsetTop>px` and `--vv-height: <height>px` at once and on every `resize` and `scroll` of `win.visualViewport`; returns the cleanup that removes both listeners. With no `visualViewport` it writes nothing and returns a no-op.

- [ ] **Step 1: Write the failing tests** (fake window: an `EventTarget` with `offsetTop`/`height` fields, `setProperty` spy)
  - `writes top and height at once`: offsetTop 0, height 852 → `setProperty('--vv-top','0px')`, `('--vv-height','852px')`.
  - `follows resize and scroll`: set height 333, dispatch `resize` → `--vv-height` `333px`; set offsetTop 120, dispatch `scroll` → `--vv-top` `120px`.
  - `cleanup stops updates`: call the cleanup, change height and offsetTop, dispatch `resize` and `scroll` → no new call.
  - `no visualViewport: writes nothing`: `setProperty` never called; cleanup callable.
- [ ] **Step 2:** `pnpm vitest run src/lib/visualViewport.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `trackVisualViewport` as above. A comment names `src/components/ui/dialog.tsx` as the reader of the two variables.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** In `RootDocument`'s existing `useEffect`, call `trackVisualViewport(window)` and return its cleanup (keep `registerServiceWorker(router)`).
- [ ] **Step 6:** `pnpm typecheck && pnpm lint`, commit `Track the visual viewport in CSS variables`.

### Task 2: Dialog sits in the visible part of the screen

**Files:**
- Modify: `src/components/ui/dialog.tsx` (`DialogContent` class)
- Modify: `e2e/keyboard.spec.ts`, `e2e/suites.ts` (keyboard suite seed `family` → `tasks`, which has users and a task Táta gave)

**Interfaces:**
- Consumes: `--vv-top`, `--vv-height` from Task 1; `useKeyboard`, `expectAboveKeyboard`, `PHONE_BROWSER` from `e2e/keyboard.ts`.
- Produces: `export const dialogPlacement: string` in `dialog.tsx` (the position and height classes, used by `DialogContent`, with a comment naming `src/lib/visualViewport.ts` as the writer). In `e2e/keyboard.ts`: `panKeyboard(page: Page, top: number): Promise<void>` sets the fake visual viewport's `offsetTop` (and `pageTop`) and dispatches `scroll`, as iOS does when it slides the visible part down the page; `expectAboveKeyboard` checks against `[offsetTop, offsetTop + visible height]` instead of `[0, visible height]`.

- [ ] **Step 1: Write the failing e2e cases** in `e2e/keyboard.spec.ts` (each opens the dialog and lets Radix focus the field; no manual `focus()`):
  - `Správa, Nové heslo: the dialog's field is visible when it opens` — admin → Správa → `Upravit Táta` → `cs.admin.reset`; wait for `#__keyboard`; `expectAboveKeyboard(page, dialog textbox)`.
  - `Úkol, Zrušit úkol?: the reason field is visible when typing` — tata → first task he gave → `cs.cancelTask.hint` button; focus the reason textarea with `openKeyboard`; `expectAboveKeyboard`.
  - `Správa, Nové heslo: the dialog follows the visible part when iOS slides it down` — open Nové heslo as above, `panKeyboard(page, 120)`, then `expectAboveKeyboard(page, field)` (now inside `[120, 120 + 333]`).
  - `Úkol, Zrušit úkol? with a taller keyboard: the dialog shrinks and scrolls inside` — `useKeyboard(page, 450)` (this test's own keyboard), open Zrušit úkol?, focus the reason with `openKeyboard`; `expectAboveKeyboard(page, dialog)` (the whole dialog box fits the 218 px left) and `expectAboveKeyboard(page, field)`.
  - Existing login and Nový člověk cases still pass on the `tasks` seed.
- [ ] **Step 1b: Unit test** `src/components/ui/dialog.test.ts`: `dialogPlacement` contains `var(--vv-top,0px)`, `var(--vv-height,100dvh)` (the fallbacks that keep today's centring with no keyboard), `max-h-` and `overflow-y-auto`.
- [ ] **Step 2:** `pnpm build && npx playwright test --project keyboard` → the four new cases FAIL (field under the keyboard); the unit test FAILS (no `dialogPlacement`).
- [ ] **Step 3:** Add `panKeyboard` and the offset-aware `expectAboveKeyboard` to `e2e/keyboard.ts`. Move the placement classes of `DialogContent` into `dialogPlacement`: replace `top-1/2` with `top-[calc(var(--vv-top,0px)+var(--vv-height,100dvh)/2)]`, add `max-h-[calc(var(--vv-height,100dvh)-2rem)] overflow-y-auto`. Keep `left-1/2 -translate-1/2` and the animations.
- [ ] **Step 4:** Same command → all keyboard cases PASS; `pnpm test` and the full `npx playwright test` stay green (dialogs without a keyboard unchanged).
- [ ] **Step 5:** Commit `Centre dialogs in the part of the screen the keyboard leaves`.

### Task 3: Screenshots

- [ ] **Step 1:** In one Playwright run (outside the repo, demo seed), take for both dialogs (Nové heslo as admin, Zrušit úkol? as tata): no keyboard and keyboard open (`useKeyboard` + the field focused), at 360×800 for the UX judge (`<screen>-<role>-<state>.png`, `-keyboard-<field>` for the open ones) and at 393×852 @3x for the brief. Look at each: the field is whole above the keyboard; the top edge of the buttons shows or the dialog visibly scrolls; the no-keyboard shots match today's centred dialog.
- [ ] **Step 2:** The brief asks Jakub to check both dialogs on his iPhone (installed app and browser) on the preview, since the simulation's slide (`panKeyboard`) is a model of iOS, not iOS.

