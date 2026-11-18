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
- **Wrap in `TaskRow`, for every row.** The chip + meta line becomes `flex flex-wrap`. This also reaches the other `TaskRow`s that pass a `meta`: "Čeká na tebe" on a taker's Domů (`WaitingForYou`, "Nabízí <jméno>" + "Souhlasím"), the Úkoly list (`src/routes/_app/ukoly/index.tsx`, "Rezervoval…" / "Udělal…" + an action button) and `/dev/ui`. Today they cut the meta first; after this they wrap it under the chip. `TakerBoard` passes no meta and does not change. The name keeps `line-clamp-2` (a 30-letter Czech name fits in 2 lines at 360 px once the buttons are icons).
- **No demo-data change.** The demo seed has no tasks yet; screenshots are taken on tasks created in the app (steps in Task 3).

## Review Focus

1. A long Czech name ("Vyluxovat celý obývák a chodbu", 30 letters) at 360 px in every row with a meta (Ke schválení, Čeká na tebe, Úkoly): name not clamped, chip whole, meta whole. Checked by measurement + screenshot in Task 3.
2. Approve and reject are never swapped: the ✓ green button is "Schválit", the ✕ outlined one "Zamítnout" (Task 1 test pins label + colour + icon per button).
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

Helper in the test: `buttons(html)` returns every `<button …>…</button>` substring (`html.match(/<button[\s\S]*?<\/button>/g)`), and `byLabel(html, label)` the one whose opening tag has `aria-label="<label>"` (exactly one, else throw).

```tsx
it('shows ✕ Zamítnout and ✓ Schválit as 44 px icon buttons, each with its own label, colour and icon', () => {
  const html = renderToStaticMarkup(<ToApprove items={[item]} />)
  expect(buttons(html)).toHaveLength(2)
  const reject = byLabel(html, cs.work.reject)
  const approve = byLabel(html, cs.work.approve)
  expect(reject).toContain('border-state-rejected') // variant "no"
  expect(reject).toContain('lucide-x')
  expect(reject).not.toContain('lucide-check')
  expect(approve).toContain('bg-ok') // variant "ok"
  expect(approve).toContain('lucide-check')
  expect(approve).not.toContain('lucide-x')
  for (const b of [reject, approve]) {
    expect(b).toContain('size-tap')
    expect(b).not.toMatch(/>(Zamítnout|Schválit)</) // no visible text to squeeze the row
  }
  expect(html).toContain(`${cs.work.doneBy} Mladší`)
})
it('disables both buttons and marks Schválit busy while an approve runs', () => {
  // mock busy: 'approve-<id>'
  const html = renderToStaticMarkup(<ToApprove items={[item]} />)
  expect(byLabel(html, cs.work.reject)).toMatch(/<button[^>]*disabled/)
  expect(byLabel(html, cs.work.approve)).toMatch(/<button[^>]*disabled/)
  expect(byLabel(html, cs.work.approve)).toMatch(/<button[^>]*aria-busy="true"/)
  expect(byLabel(html, cs.work.reject)).not.toContain('aria-busy="true"')
})
```

The `busy` value comes from a mutable variable read by the `useTaskAction` mock, set per test.

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
  const line = html.match(/<div[^>]*data-slot="task-status"[^>]*>/)?.[0] ?? ''
  expect(line).toContain('flex-wrap')
  const meta = html.match(/<span[^>]*data-slot="task-meta"[^>]*>/)?.[0] ?? ''
  expect(meta).toContain('max-w-full')
  expect(meta).toContain('truncate')
  expect(meta).not.toMatch(/min-w-0|shrink-/)
})
it('renders no meta span without meta', () => {
  const html = renderToStaticMarkup(<TaskRow name="Vynést koš" state="open" points={5} />)
  expect(html).not.toContain('data-slot="task-meta"')
})
```

- [ ] **Step 2: Run** `pnpm test src/components/tasks/tasks.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** Line container: `data-slot="task-status"`, `flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted`. Chip: `className="max-w-full"`. Meta span: `data-slot="task-meta" className="max-w-full truncate"` (drop `min-w-0 shrink-[1000]`). Replace the two layout comments with one: "Chip and meta sit side by side when they fit, else the meta wraps under the chip; an item is cut only when it alone is wider than the column."
- [ ] **Step 4: Run** → PASS. Then `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** `Task row: wrap the meta line instead of cutting it`.

### Task 3: Check at 360 px (no repo change)

- [ ] **Step 1:** `TASKMASTER_ENV=preview DATA_DIR=<tmp> pnpm dev`. Playwright (viewport 360 × 740, light): as `tata` create a one-time task "Vyluxovat celý obývák a chodbu" (5 b) and one short "Zalít kytky".
- [ ] **Step 2:** Before anyone agrees: as `starsi` open Domů, screenshot `home-starsi-waiting.png` ("Čeká na tebe" with the long name, "Nabízí Táta", "Souhlasím"). Then as `starsi` and `mladsi` agree; as `mladsi` reserve and mark both done; as `tata` open Domů and Úkoly.
- [ ] **Step 3: Measure** in the page, for every `TaskRow` on "Čeká na tebe" (starsi), "Ke schválení" (tata) and Úkoly (tata): the name is not clamped (`scrollHeight <= clientHeight` on the name div), and `scrollWidth <= clientWidth` on the chip label and the meta span (nothing cut). Also no horizontal page scroll (`document.documentElement.scrollWidth <= 360`). Expected: all pass.
- [ ] **Step 4: Screenshots** (360 px, outside the repo), all required: `home-starsi-waiting.png` (Step 2), `home-tata-to-approve.png`, `home-tata-reject-form.png` (after ✕), `ukoly-tata-list.png`. Look at each: name, chip and meta whole. Plus 390 px shots for the brief.
- [ ] **Step 5:** full `pnpm test`, `pnpm build`.
