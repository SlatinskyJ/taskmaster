# Ke schválení row on a 360 px phone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#131 Ke schválení row cuts the task name and hides who did it on a 360 px phone](https://github.com/SlatinskyJ/taskmaster/issues/131)

**Goal:** On a 360 px phone a giver reads the whole task name (up to 2 lines), the whole state chip and "Udělal <jméno>" in every "Ke schválení" row before tapping approve or reject.

**Architecture:** Two small UI changes. (1) `ToApprove` swaps its two text buttons for 44 px icon buttons (✕ Zamítnout, ✓ Schválit), as the GHome mockup draws them. That frees about 100 px for the text. (2) `TaskRow`'s chip + meta line wraps instead of squeezing: the meta goes to its own line when chip and meta don't fit side by side, and an item is cut only when it alone is wider than the whole text column. No server, DB or domain change.

**Tech Stack:** React, Tailwind v4, `lucide-react` (already a dependency: `Minus`/`Plus` in `src/routes/_app/ukoly/novy.tsx`), Vitest with `renderToStaticMarkup`.

**Spec:** spec §5.5 (giver approves or rejects a completion); UI doc §1 (44 px tap targets), §2.2 (row anatomy), §7 mockup `GHome` ("Ke schválení" rows with ✕ / ✓ icon buttons).

**Size:** about 25 changed lines of source (`ToApprove.tsx`, `TaskRow.tsx`), plus tests.

## Global Constraints

- UI text in Czech, only from `src/lib/strings.ts`. No new strings: the icon buttons use the existing `cs.work.reject` ("Zamítnout") and `cs.work.approve` ("Schválit") as `aria-label`.
- Every tap target ≥ 44 px: `size="icon"` on `Button` is `size-tap` (44 × 44).
- Theme tokens only, no raw hex.

## Decisions

- **Icon buttons, not buttons on a second line.** Matches the GHome mockup and keeps each row one card tall. Reject stays `variant="no"`, approve `variant="ok"`, so colour still tells them apart; the icons are lucide `X` and `Check`, `aria-hidden`.
- **Wrap in `TaskRow`, for every row.** The chip + meta line becomes `flex flex-wrap`. This also covers the other rows that use `TaskRow` (`WaitingForYou`, `TakerBoard`) with a long meta: today they cut the meta first; after this they wrap it. Nothing else in those rows changes. The name keeps `line-clamp-2` (a third line is cut with "…": a 30-letter Czech name fits in 2 lines at 360 px once the buttons are icons).
- **No demo-data change.** The demo seed has no tasks yet; screenshots are taken on tasks created in the app (steps in Task 3).

## Review Focus

1. A long Czech name ("Vyluxovat celý obývák a chodbu", 30 letters) with "Udělal Mladší" at 360 px: name on ≤ 2 lines, chip whole, meta whole. Checked by screenshot + measurement in Task 3.
2. Screen-reader and test lookup by name still work: buttons are found by role + name "Schválit" / "Zamítnout" (Task 1 test).
3. While an approve runs, both icon buttons are disabled and approve has `aria-busy` (unchanged behaviour, Task 1 test).
4. After Zpět in the reject form, focus returns to that row's ✕ button (ref kept on the icon button; unchanged code path).
5. A row with no completer (`completedBy` null) renders no empty meta span (unchanged; Task 2 test).

---

### Task 1: Icon buttons in `ToApprove`

**Files:**
- Modify: `src/components/tasks/ToApprove.tsx` (the `action` block)
- Test: `src/components/tasks/tasks.test.tsx` (new `describe('ToApprove')`)

**Interfaces:**
- Consumes: `Button` from `~/components/ui/button` with `size="icon"`; `X`, `Check` from `lucide-react`.
- Produces: nothing new; `ToApprove({ items })` keeps its props.

- [ ] **Step 1: Write the failing test.** `vi.mock('./useTaskAction', () => ({ useTaskAction: () => ({ busy: null, run: vi.fn() }) }))` and `vi.mock('~/server/tasks/functions', () => ({ approveTaskFn: vi.fn(), rejectTaskFn: vi.fn() }))`. Render one item (`title: 'Vyluxovat celý obývák a chodbu'`, `score: 5`, `completedBy: { name: 'Mladší' }`, other `TaskView` fields filled with valid values).

```tsx
it('shows reject and approve as 44 px icon buttons named in Czech', () => {
  const html = renderToStaticMarkup(<ToApprove items={[item]} />)
  expect(html).toContain(`aria-label="${cs.work.reject}"`)
  expect(html).toContain(`aria-label="${cs.work.approve}"`)
  expect(html.match(/size-tap/g)).toHaveLength(2)
  expect(html.match(/<svg/g)).toHaveLength(2)
  // No visible button text left to squeeze the row.
  expect(html).not.toContain(`>${cs.work.approve}<`)
  expect(html).not.toContain(`>${cs.work.reject}<`)
  expect(html).toContain(`${cs.work.doneBy} Mladší`)
})
it('disables both buttons while an action runs', () => { /* mock busy: 'approve-1' */
  // both <button> tags have `disabled`, approve has aria-busy="true"
})
```

- [ ] **Step 2: Run** `pnpm test src/components/tasks/tasks.test.tsx` → FAIL (no aria-label, text buttons).
- [ ] **Step 3: Implement.** In `ToApprove`, both buttons get `size="icon"` and `aria-label={cs.work.reject}` / `aria-label={cs.work.approve}`; their children become `<X aria-hidden="true" />` / `<Check aria-hidden="true" />`. Keep the ref, `variant`, `disabled`, `aria-busy`, onClick and confetti exactly as they are. Update the component comment ("✕ Zamítnout opens a reason field…").
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `Ke schválení: icon buttons for reject and approve`.

### Task 2: Chip and meta wrap in `TaskRow`

**Files:**
- Modify: `src/components/tasks/TaskRow.tsx` (the chip + meta line, ~lines 45–50)
- Test: `src/components/tasks/tasks.test.tsx` (`describe('TaskRow')`)

**Interfaces:**
- Consumes / produces: `TaskRow` props unchanged.

- [ ] **Step 1: Write the failing test.**

```tsx
it('wraps the meta under the chip instead of squeezing it', () => {
  const html = renderToStaticMarkup(
    <TaskRow name="Vyluxovat celý obývák a chodbu" state="pending" points={5} meta="Udělal Mladší" />,
  )
  expect(html).toMatch(/class="[^"]*flex-wrap[^"]*"/)
  expect(html).not.toContain('shrink-[1000]')
})
it('renders no meta span without meta', () => {
  const html = renderToStaticMarkup(<TaskRow name="Vynést koš" state="open" points={5} />)
  expect(html).not.toContain('truncate">') // only the chip's own label span may truncate
})
```

(Adjust the second assertion to whatever uniquely marks the meta span, e.g. a `data-slot="task-meta"` added in Step 3.)

- [ ] **Step 2: Run** `pnpm test src/components/tasks/tasks.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** Line container: `flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted`. Chip: `className="max-w-full"`. Meta span: `data-slot="task-meta" className="max-w-full truncate"` (drop `min-w-0 shrink-[1000]`). Replace the two layout comments with one: "Chip and meta sit side by side when they fit, else the meta wraps under the chip; an item is cut only when it alone is wider than the column."
- [ ] **Step 4: Run** → PASS. Then `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** `Task row: wrap the meta line instead of cutting it`.

### Task 3: Check at 360 px (no repo change)

- [ ] **Step 1:** `TASKMASTER_ENV=preview DATA_DIR=<tmp> pnpm dev`. Playwright (viewport 360 × 740, light): as `tata` create a one-time task "Vyluxovat celý obývák a chodbu" (5 b) and one short "Zalít kytky"; as `mladsi` agree, reserve and mark both done; as `tata` open Domů.
- [ ] **Step 2: Measure** in the page: for each row in "Ke schválení", the name's line count ≤ 2 and `scrollWidth <= clientWidth` for the chip label and the meta span (nothing cut). Expected: all pass. Also no horizontal page scroll (`document.documentElement.scrollWidth <= 360`).
- [ ] **Step 3: Screenshots** (360 px, outside the repo): `home-tata-to-approve.png`, `home-tata-reject-form.png` (after ✕), `home-mladsi-taker-board.png` and `home-starsi-waiting.png` if they show a `TaskRow` with a meta (the wrap change touches them). Plus 390 px shots for the brief.
- [ ] **Step 4:** full `pnpm test`, `pnpm build`.
