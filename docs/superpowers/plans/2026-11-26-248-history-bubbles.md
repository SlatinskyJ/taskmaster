# Task history as chat bubbles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** [#248 Show task history as chat bubbles](https://github.com/SlatinskyJ/taskmaster/issues/248)

**Goal:** A task's Historie shows each entry as a chat bubble (mine left, others right), system entries as centred notes, round dividers kept; the date and time appear only after a tap.

**Architecture:** UI only. `historyText.ts` gains one framework-free function, `historyItems`, that turns the server's `HistoryEntry[]` into a list of layout items (round divider, note, bubble with side, name, joins). `TaskHistory.tsx` renders those items and keeps one piece of client state: which entries show their time. No server, DB, domain, string or theme change.

**Tech Stack:** React 19, Tailwind v4 (theme tokens in `src/styles/theme.css`), Vitest (static markup), Playwright.

**Spec:** spec §5.10 (history from the audit log) is unchanged; this is the look of the GTask "Historie" block (UI doc §7.2). The design is the wireframe Jakub settled on 2026-11-26 (Design canvas "Historie jako bubliny"), with his rulings:

1. My entries on the **left**, everyone else's on the **right** (issue text).
2. Date and time hidden; a tap on a bubble shows it under the bubble, a second tap hides it (Jakub 18:37 Prague).
3. Bubbles of one person in a row sit close together (Jakub 18:41).
4. In a run, the corners on the bubble's own edge side are square where bubbles meet; the first bubble's top edge corner is square too, on both sides; only the last bubble's bottom edge corner is round (Jakub 18:42, 18:47).
5. My bubbles are **dark**: background `--ink`, text `--bg` (option 4, Jakub 18:49). Others: `--surface` with a `--track` border.

Out of scope: "Historie ceny" on `/sablona` (a follow-up issue, opened with this PR).

**Size:** about 150 changed lines outside tests (TaskHistory about 90, historyText about 60). Under 300 and no protected area, but the issue asks for a plan.

## Global Constraints

- UI labels in Czech, only from `src/lib/strings.ts`; this PR adds no string (every text already exists in `cs.history`).
- Prague times only through `historyTime` (already uses `src/domain/dates.ts`).
- Component tests render static markup only; the tap is tested in e2e.
- Phone first: 360 px wide, no horizontal scroll, tap targets ≥ 44 px (`min-h-tap`).
- Colours only from theme tokens (`bg-ink`, `text-bg`, `bg-surface`, `border-track`, `bg-track`, `text-muted`, `shadow`), so dark mode follows by itself.

## Review Focus

1. A long Czech name ("Kristýna-Magdaléna") or long phrase ("domluveno za 11 b · rezervace: Kristýna-Magdaléna") at 360 px: name and bubble text wrap inside 80 % of the width, never overflow. Pinned by the 360 px screenshot and `break-words` on both.
2. A run broken by a round divider or a system note: the bubble after it starts a new run (name shown again, round top corner rules restart). Pinned in `historyItems` tests.
3. The same person on the other side of a divider is a new run; two different others in a row are two runs, each with its name. Pinned in tests.
4. Mine vs theirs decided by `by.id === meId`, not by name (two people may share a display name). Pinned in tests.
5. Reason on a dark bubble stays readable in light and dark mode: `text-bg/75` on `bg-ink`. Light: #fff5ee at 75 % over #2b1f2e ≈ 9:1; dark: #1d1524 at 75 % over #fff1e8 ≈ 10:1. Note pill: `text-muted` on `bg-track` is 4.65:1 (light). Checked on screenshots.

---

### Task 1: `historyItems`, the layout list

**Files:**
- Modify: `src/components/tasks/historyText.ts`
- Test: `src/components/tasks/historyText.test.ts`

**Interfaces:**
- Consumes: `HistoryEntry` (`src/server/tasks/history.ts`), existing `historyTime`, `historyReason`, `historyRounds`.
- Produces:

```ts
export type HistoryItem =
  | { kind: 'round'; key: string; round: number }
  | { kind: 'note'; id: number; text: string; reason: string | null; time: string }
  | {
      kind: 'bubble'
      id: number
      side: 'mine' | 'theirs'
      /** Shown above the bubble: only on theirs, only on the first bubble of a run. */
      name: string | null
      text: string
      reason: string | null
      time: string
      /** The item above / below is a bubble by the same person (a run). */
      joinAbove: boolean
      joinBelow: boolean
    }

/** The phrase without time or name: "chce 12 b". Was the private `phrase`. */
export function historyText(e: HistoryEntry, meId: number): string
export function historyItems(entries: readonly HistoryEntry[], meId: number): HistoryItem[]
```

`historyLine` is removed (its only user is `TaskHistory`). A round item comes before the entry `historyRounds` maps to it (key `round-<n>`). An entry with `by === null` is a note. A run is consecutive bubbles with the same `by.id`; a round or a note ends it.

- [ ] **Step 1: Rewrite the `historyLine` tests as `historyText` tests** (same table, expected value is the bare phrase, e.g. `['task.bid_placed', 'chce 8 b']`; the "ty" case becomes: `historyText(agreed, 3)` is `'domluveno za 8 b · rezervace: ty'`; the system case: `historyText(entry({ action: 'instance.created', by: null, score: 4 }), 2)` is `'přidáno podle rozvrhu za 4 b'`). Keep `historyTime`, `historyReason`, `historyRounds` tests as they are.

- [ ] **Step 2: Add `historyItems` tests**

```ts
describe('historyItems', () => {
  const by = (id: number, name: string) => ({ by: { id, name } })
  it('mine left (no name), theirs right with a name, the system as a note', () => {
    const items = historyItems(
      [
        entry({ id: 1, ...by(2, 'Táta') }),
        entry({ id: 2, action: 'task.bid_placed', score: 12, ...by(4, 'Mladší') }),
        entry({ id: 3, action: 'instance.expired', by: null }),
      ],
      4,
    )
    expect(items).toEqual([
      expect.objectContaining({ kind: 'bubble', id: 1, side: 'theirs', name: 'Táta', text: 'nový úkol za 8 b', time: 'so 21. 11. 10:12', joinAbove: false, joinBelow: false }),
      expect.objectContaining({ kind: 'bubble', id: 2, side: 'mine', name: null, text: 'chce 12 b' }),
      expect.objectContaining({ kind: 'note', id: 3, text: 'prošlo', time: 'so 21. 11. 10:12' }),
    ])
  })
  it('a run: same person in a row joins, the name only on the first', () => { /* ids 1,2,3 by Táta → joinAbove false,true,true; joinBelow true,true,false; name 'Táta',null,null */ })
  it('a different person, a note or a round divider ends a run', () => { /* Táta, Kristýna-Magdaléna, Táta → three runs, three names; Táta, note, Táta → two runs; Táta, reopen by Táta → round item between, the reopen bubble has joinAbove false and its name */ })
  it('mine is by id, not by name', () => { /* two entries by {id:2,name:'Táta'} and {id:5,name:'Táta'}, meId 5 → theirs, mine; not joined */ })
  it('rounds: a divider item before each round start, only once reopened', () => { /* created, bid, bidding_reopened, bid → round 1, bubble, bubble, round 2, bubble, bubble; never reopened → no round item */ })
  it('a reason stays with its entry', () => { /* task.rejected reason 'Pod postelí to pořád je.' → reason '„Pod postelí to pořád je.“' */ })
})
```

Fill the commented cases with the exact `toEqual` / `objectContaining` assertions they describe.

- [ ] **Step 3: Run, expect FAIL** — `pnpm test src/components/tasks/historyText.test.ts` → `historyItems is not a function` / `historyText` not exported.

- [ ] **Step 4: Implement** `historyText` (export `phrase`, renamed) and `historyItems` in `historyText.ts`; delete `historyLine`. One pass to build items, then set `joinBelow` from the next item.

- [ ] **Step 5: Run, expect PASS**; `pnpm typecheck` fails only in `TaskHistory.tsx` (fixed in Task 2), so commit Task 1 and 2 together.

### Task 2: `TaskHistory` renders bubbles, tap shows the time

**Files:**
- Modify: `src/components/tasks/TaskHistory.tsx`
- Test: `src/components/tasks/taskPage.test.tsx` (the two history cases), `e2e/task-page.spec.ts`

**Interfaces:**
- Consumes: `historyItems`, `HistoryItem` (Task 1).
- Produces: same component signature `TaskHistory({ entries, meId })`; same `<section aria-labelledby="history-label">` region named `cs.history.title` (e2e finds it by that).

Layout, per item (an `<li>` each, inside the existing `Card` / `<ol>`; drop the `gap-2` on the `<ol>`):

| Item | Markup and classes |
| --- | --- |
| round | unchanged divider `<li role="separator" aria-label=… data-round=…>`; `mt-3.5 first:mt-0` |
| note | `<li class="mt-3.5 first:mt-0 flex flex-col items-center text-center">`; a `<button type="button" aria-expanded aria-controls="history-time-<id>" class="min-h-tap px-2">` holding a `<span class="inline-block rounded-full bg-track px-3 py-1 text-meta font-bold text-muted">` with the text and, if any, the reason; under it the time `<p id="history-time-<id>" hidden={!open} class="text-xs font-medium text-muted">` |
| bubble | `<li class="flex flex-col gap-0.5 items-start|items-end">`, top margin `mt-[3px]` when `joinAbove` else `mt-3.5 first:mt-0`; name (theirs, when set) `<span class="max-w-[80%] break-words px-1.5 text-xs font-extrabold text-muted text-right">`; the bubble `<button type="button" aria-expanded aria-controls="history-time-<id>" class="min-h-tap max-w-[80%] break-words rounded-[18px] px-3 py-2 text-left font-bold">` with the text, and the reason on its own line (`block font-medium`, `text-bg/75` on mine, `text-muted` on theirs); the time `<p id=… hidden={!open} class="px-1.5 text-xs font-medium text-muted">` |

Bubble colours and corners:
- mine: `bg-ink text-bg`; theirs: `border border-track bg-surface text-ink shadow-sticker`.
- Edge side = left for mine, right for theirs. Top edge corner always `rounded-tl-[4px]` (mine) / `rounded-tr-[4px]` (theirs). Bottom edge corner `rounded-bl-[4px]` / `rounded-br-[4px]` only when `joinBelow`.

State: `const [open, setOpen] = useState<ReadonlySet<number>>(new Set())`; a tap toggles that entry's id. No animation (nothing to opt out of with `motion-reduce`). No request, so no busy or error state.

- [ ] **Step 1: Update the two static tests in `taskPage.test.tsx`.** "shows the history with the reason": expect `cs.history.title`, `Táta` and `zrušeno` and `„Udělá to firma.“`; the time `so 21. 11. 10:12` is in the markup on a `hidden` element: `expect(html).toMatch(/<p id="history-time-1" hidden="">[^<]*so 21\. 11\. 10:12/)` (adjust to React's exact `hidden=""` output); no separator. The round test: indices of `cs.history.round(1)` < `chce 5 b` < `cs.history.round(2)` < `chce 12 b`, separator markup unchanged. Add a side test: as `STARSI` (id 3), one entry by Starší and one by Táta; cut the markup into the two `<li>`s (split on `<li`) and assert the Starší one has `items-start` and `bg-ink` and no `Starší` name label, the Táta one has `items-end`, `Táta` and not `bg-ink` (the `Card` itself is `bg-surface`, so never assert `bg-surface` on the whole markup). Add a note test: an entry with `by: null` (`instance.expired`) renders `prošlo` inside a `<button type="button" aria-expanded="false" aria-controls="history-time-<id>"`, its `<p id="history-time-<id>" hidden="">` holds the time, and the `<li>` has `items-center`.
- [ ] **Step 2: Run, expect FAIL** — `pnpm test src/components/tasks/taskPage.test.tsx`.
- [ ] **Step 3: Implement `TaskHistory`** as the table above.
- [ ] **Step 4: Run, expect PASS**; then `pnpm typecheck && pnpm lint`.
- [ ] **Step 5: e2e tap check inside the existing test** `'saying no, agreeing to a new price, and cancelling a task'` in `e2e/task-page.spec.ts`, right after step (a)'s `toContainText(cs.history.changeDeclined(12))` (the `tasks` suite shares one DB, `workers: 1`; a separate test would see what the other left behind). Starší is on the page: `const bubble = history(page).getByRole('button', { name: cs.history.changeDeclined(12) })`, `const other = history(page).getByRole('button').first()` (a different entry: assert its `aria-controls` differs from the bubble's), times `page.locator('#' + (await bubble.getAttribute('aria-controls')))` and the same for `other`. Both times hidden; click `bubble` → its time visible and matching `/\d{1,2}\. \d{1,2}\. \d{2}:\d{2}/`, `other`'s time still hidden; click `bubble` again → hidden. Run `pnpm exec playwright test e2e/task-page.spec.ts --trace off`; expect PASS. `e2e/rebidding.spec.ts` (`toContainText` on the region) must still pass: run it too.
- [ ] **Step 6: Commit** Task 1 and 2: `git commit -m "Show task history as chat bubbles (#248)"`.

### Task 3: Follow-up issue and screenshots

- [ ] Open issue "Show chore price history as chat bubbles" (label `feature`), body: `/sablona` "Historie ceny" could take the #248 look; link #248.
- [ ] Screenshots for the UX judge and brief (pr-review-rounds §1, code phase): task page Historie as `starsi` and as `tata` on the `rebid` seed (two rounds), one with a time opened, one at 360×800 with the longest name in the seed, dark theme once; a recurring instance with a schedule note (`recurring` seed, or `scheduler` seed if that is where `by: null` entries exist).
