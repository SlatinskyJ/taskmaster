# Bidding screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Issue:** #34 Bidding on one-time tasks (PR B of 2, closes it). Stacked on PR #136 (branch `34-bidding`, the server side).

**Goal:** The family can bid, change an offer and accept on a phone: a task page with the bid thread for takers and givers, and the ways into it from Domů and Úkoly.

**Architecture:** Every decision a screen makes (which buttons, which labels, what a counter would do, which takers a giver saw) lives in one framework-free module, `src/components/tasks/taskView.ts`, and is unit-tested. Components only render what it returns and call the server function `BID_CALLS` maps the action to. The server from PR #136 already checks everything again; the screens send back exactly what they showed (the offer, the lowest bid and its bidders, the takers at a counter's number), so a stale screen is refused with "offer changed", never agreed.

**Tech Stack:** TanStack Start (React, file routes), Tailwind v4 + the shadcn pieces in `src/components/ui`, Vitest with `renderToStaticMarkup`.

**Spec:** `docs/superpowers/specs/2026-11-16-taskmaster-design.md` §5.2 (path 2 and Details, with the #133 sentences: a bidder's yes picks; a giver may counter any time; a counter at a bid's number accepts it), §5.4 (reserve from "Volné" after a tie). UI: `docs/superpowers/specs/2026-11-16-taskmaster-ui-design.md` §2.2 (state chips: `negotiating` = "Vyjednává se"), the screens TTask, GBid, GHome (§7.2 order), the "Taskmaster Screens" artifact.

## Global Constraints

- UI labels in Czech, only in `src/lib/strings.ts`; code in English.
- Dates through `src/domain/dates.ts` (Prague wall clock).
- Every tap target at least 44 px (`min-h-tap`, `size-tap`; `Button` keeps it); every animation has a `motion-reduce:` opt-out.
- Highest score: `TASK_SCORE_MAX` (999, `src/lib/taskLimits.ts`); the server refuses more.
- Server function names from PR #136: `placeBidFn`, `acceptOfferFn`, `counterOfferFn` (`{ taskId, score, bidders }`, 0–50 distinct ids), `acceptLowestTaskBidFn` (`{ taskId, score, bidders }`, 1–50), `approveTaskOfferFn`, `getTaskDetailFn`, `listBidsToAnswerFn`; all return `TaskActionResult` (`{ ok: true; id; status } | { ok: false; error }`).
- `TaskView` (PR #136) carries `offeredByName`, `bids` (lowest first), `lowest` (`{ score, bidders: {id,name}[] } | null`), `approverIds`, `approvedBy`. This PR adds `waitingFor: { id: number; name: string }[]`: while proposed, the active people of each side `missingRoles` still lists (any one of them agreeing is enough), in `views()` in `src/server/tasks/tasks.ts`; `[]` otherwise.

## Decisions carried into this plan

1. **One task page for both sides** (`/ukol/$taskId`): TTask for a brother, GBid for a parent. Reserve, done and release stay on Domů (#35); the page has a back button to it.
2. **A brother who bid picks** (Jakub 2026-11-18, spec #133): two buttons, "Beru za 18" (reserved to him, hint "Úkol bude tvůj.") above "Souhlasím" (open for both, hint "Úkol bude volný pro všechny."). A brother without a bid sees "Souhlasím" only. Neither shows once he is in `approverIds`.
3. **A parent may change the offer any time** (decision 8a): "Nová nabídka" shows with or without bids.
4. **A counter at a bid's number accepts it** (decision 8b): when the stepper stands on a number brothers bid, the send button's label and hint say so ("Přijmout 22 (Mladší)", "Úkol bude rezervovaný pro Mladší." / for several "Stejnou cenu chce víc lidí. Úkol bude volný."), and the call sends those brothers as `bidders`. Elsewhere it says "Nabídnout" with "Nová nabídka pro všechny."
5. **No confirm dialog on the yes buttons.** Each one carries its outcome as a hint right under it, as "Souhlasím" from #33 already does; a dialog on every agreement would double the taps for the most common action. The only irreversible step a person can't see coming is the counter that lands on a bid, and its button label changes to "Přijmout …" for exactly that.
6. **Rows stay short, the page does the explaining.** A "Čeká na tebe" row for a brother without a bid keeps "Souhlasím" and gains "Jiná cena" (to the page); with a bid, only "Otevřít": the pick needs both hints, which a row has no room for.

## Size

About 480 changed lines outside tests and generated files: `taskView.ts` 140, `waitingFor` in `tasks.ts` 15, `BidPanel` 110, route 60, `BidThread` 40, `ScoreStepper` 40 (moved from `novy.tsx`), `BidsToAnswer` 35, strings 50, the rest small edits. Over 400 because the page, its panel and its entry points only make sense together: a page with no way in, or a "Jiná cena" link to no page, can't be reviewed or used alone.

## Pre-flight (pr-review-rounds §1)

- Tests: audit rollback and wrong actor are server-side (PR #136, done). Boundaries here: the score stepper at 1 and at `TASK_SCORE_MAX` (Task 1); a counter at exactly a bid's number vs one off (Task 1). Real entry point: the route is walked once in the app (Task 2, step 5) and `tests/screen-guards.test.ts` requires its guard. Returned shape: `answered` pinned (Task 1).
- UX: 44 px buttons (all `Button`); `motion-reduce` on nothing new that animates (no new animation); busy state on every button (`aria-busy`, label "Ukládám…") and a Czech toast + reload on failure (`useTaskAction`); the route's loader error goes to the app's `RouteError`, a missing task to `NotFound`; empty states: "Vyjednávání" renders nothing when empty, the thread always has the first offer; no dialog (decision 5); long names at 360 px: the page title wraps (two lines, then cut), rows keep `TaskRow`'s two-line clamp, every row's meta is short ("Mladší chce 22", "Táta 20 · ty 25") and buttons stack under the text where a row has two.

## Review Focus

1. A brother opens the page, a parent counters meanwhile, he taps a yes button: the server refuses with "offer changed", the page shows the Czech message and the fresh state (`useTaskAction` reloads). A brother's new bid does not change the offer, so a yes tapped meanwhile is still accepted. Pinned server-side; Task 2 step 5 walks one.
2. A parent's stepper on a number two brothers bid: the button must say tie and send both ids; one brother's number must send one id. Task 1 test `sendButton`.
3. A brother who already said yes (`approverIds`) must not see "Souhlasím" again. Task 1 test `bidButtons`.
4. The task id in the URL is not a number (`/ukol/abc`, `/ukol/1.5`): not found, never a server call with garbage. Task 1 test `parseTaskIdParam`.
5. Thread times near midnight in Prague, not UTC. Task 1 test `threadTime`.

---

### Task 1: Labels, pure screen logic and the small pieces

**Files:**
- Modify: `src/lib/strings.ts`, `src/lib/taskErrors.ts`, `src/components/tasks/useTaskAction.ts`, `src/routes/_app/ukoly/novy.tsx`, `src/server/tasks/functions.ts` (export `answered`), `src/server/tasks/tasks.ts` (`waitingFor`)
- Create: `src/components/tasks/taskView.ts`, `src/components/tasks/bidCalls.ts`, `src/components/tasks/ScoreStepper.tsx`, `src/components/tasks/BidThread.tsx`
- Test: `src/components/tasks/taskView.test.ts`, `src/components/tasks/bidCalls.test.ts` (`callBid`, `BID_CALLS`), `src/components/tasks/bids.test.tsx`, `src/lib/taskErrors.test.ts`, `src/server/tasks/functions.test.ts`, `src/server/tasks/bidding.test.ts` (`waitingFor`)

**Interfaces:**
- Consumes: `TaskView`, `ThreadEntry`, `TaskActionResult` (from `~/server/tasks/functions`).
- Produces:
  - `cs.bids` (exact copy):

    ```ts
    bids: {
      thread: 'Vyjednávání',
      /** "Táta nabízí 18", "Starší chce 25"; my own: "Ty nabízíš 18", "Ty chceš 25". */
      offers: 'nabízí',
      wants: 'chce',
      /** Several takers at one bid: "Starší, Mladší chtějí 22". */
      wantMany: 'chtějí',
      youOffer: 'Ty nabízíš',
      youWant: 'Ty chceš',
      /** Me in a row's short line: "Táta 20 · ty 25". */
      you: 'ty',
      yours: 'Je to tvoje',
      replaced: 'změněno',
      accepted: 'přijato',
      closed: 'uzavřeno',
      /** Who said yes to the current offer: "Souhlasí: Táta ✓". */
      agreed: 'Souhlasí',
      /** Who the offer still waits for: "Čeká se na: Starší nebo Mladší" (any one of them is enough). */
      waitingFor: 'Čeká se na',
      or: 'nebo',
      /** Me after "na": "Čeká se na: tebe nebo Mladší". */
      youAcc: 'tebe',
      approveHint: 'Úkol bude volný pro všechny.',
      take: (score: number) => `Beru za ${String(score)}`,
      takeHint: 'Úkol bude tvůj.',
      otherPrice: 'Chci jinou cenu',
      newOffer: 'Nová nabídka',
      send: 'Nabídnout',
      sendHint: 'Nová nabídka pro všechny.',
      acceptBid: (score: number, name: string) => `Přijmout ${String(score)} (${name})`,
      acceptBidHint: (name: string) => `Úkol bude rezervovaný pro ${name}.`,
      acceptTie: (score: number) => `Přijmout ${String(score)}`,
      tieHint: 'Stejnou cenu chce víc lidí. Úkol bude volný.',
      yourBid: 'Tvoje nabídka',
      toAnswer: 'Vyjednávání',
      answer: 'Odpovědět',
      otherPriceShort: 'Jiná cena',
      open: 'Otevřít',
      /** Short weekday names, Sunday first (dates.ts `Weekday`). */
      weekdays: ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'],
      toast: { sent: 'Nabídka odeslána', agreed: 'Domluveno', agreedMine: 'Domluveno, úkol je tvůj' },
    },
    ```

    Under `cs.tasks.errors`: `sameScore: 'Tohle číslo už platí. Zvol jiné.'`, `noBids: 'Zatím nikdo nic nenabídl.'`, `noBid: 'Nejdřív nabídni svou cenu.'`, `alreadyApproved: 'Už jsi souhlasil(a).'`.
  - `taskErrorMessage`: `same_score` → `sameScore`, `no_bids` → `noBids`, `no_bid` → `noBid`, `already_approved` → `alreadyApproved`.
  - `ScoreStepper({ value, onChange, label, min = 1, max = TASK_SCORE_MAX })`: the −, `ScoreDial`, + group moved out of `novy.tsx` unchanged (− disabled at `min`, + at `max`). `novy.tsx` uses it; its quick picks stay there; `MAX_SCORE` there goes.
  - `taskView.ts` (framework-free; imports types only):
    - `type Me = { id: number; role: Role }`
    - `taskChipState(task: Pick<TaskView, 'status' | 'bids'>): ItemStateKey`: proposed with a bid → `negotiating`; `done_unconfirmed` → `pending`; else the status.
    - `type BidCall = { action: 'approveOffer' | 'acceptOffer' | 'placeBid'; data: { taskId: number; score: number } } | { action: 'acceptLowestTaskBid' | 'counterOffer'; data: { taskId: number; score: number; bidders: number[] } }` (one data shape per action, so `bidders` is required where the server needs it)
    - `type BidAction = BidCall['action']`
    - `type BidButton = BidCall & { key: string; label: string; hint: string; variant: 'ok' | 'ghost' }`
    - `bidButtons(task: TaskView, me: Me): BidButton[]`: the yes buttons, top to bottom. Not proposed, or the admin → `[]`. Brother in `approverIds` → `[]` (decision 2: neither shows). Otherwise, with his own open bid, `take` (`acceptOffer`, score = offer, `ok`) first; then `approve` (`approveOffer`, score = offer; `ok` without a bid, `ghost` under "Beru"). Parent: `acceptLowestTaskBid` when `task.lowest` is set, label `acceptBid(score, name)` + `acceptBidHint(name)` for one bidder or `acceptTie` + `tieHint` for several, `data.bidders` = `lowest.bidders` ids.
    - `myBid(task: TaskView, me: Me): number | null`: his own entry in `task.bids` (by `takerId`), never another brother's or the lowest.
    - `waitingText(task: TaskView, me: Me): string | null`: proposed only; `Čeká se na: Starší nebo Mladší` from `task.waitingFor`, my own name shown as `tebe` (`cs.bids.youAcc`); null when empty or not proposed.
    - `sendButton(task: TaskView, me: Me, value: number): (BidCall & { label: string; hint: string; disabled: boolean }) | null`: null unless proposed and a brother or parent. Brother: `placeBid`, label `send`, no hint (empty string), disabled when `value` is the offer or his own bid. Parent: `counterOffer` with `bidders` = the brothers whose bid in `task.bids` is `value`; none → `send` + `sendHint`; one → `acceptBid(value, name)` + `acceptBidHint(name)`; several → `acceptTie(value)` + `tieHint`; disabled when `value` is the offer.
    - `waitingMeta(task, me): string`: without my bid `Nabízí <offeredByName ?? createdByName>`; with it `<offeredByName> <score> · ty <myBid>`.
    - `lowestText(lowest: NonNullable<TaskView['lowest']>): string`: `Mladší chce 22` / `Starší, Mladší chtějí 22`.
    - `detailMeta(task, me): string | null`: proposed → `Nabízí <offeredByName>`; reserved by me → `Je to tvoje`; reserved by another → `Rezervoval <jméno>`; `completedBy` set → `Udělal <jméno>`; else null.
    - `threadTime(iso: string): string`: `so 10:12`, Prague wall clock via `toPragueWallTime`, minutes two digits.
    - `parseTaskIdParam(raw: string): number | null`: a positive safe integer written in plain digits, else null.
    - `toastFor(action: BidAction, status: TaskView['status'], me: Me): string`: `reserved` and `me.role === 'taker'` → `agreedMine`; `open` / `reserved` → `agreed`; `proposed` after `approveOffer` → `cs.tasks.approved`, after `placeBid` / `counterOffer` → `sent`.
  - `bidCalls.ts`: `BID_CALLS: { [A in BidAction]: (args: { data: Extract<BidCall, { action: A }>['data'] }) => Promise<TaskActionResult> }`, plus `callBid(call: BidCall): Promise<TaskActionResult>` (the one place that narrows on `action`) = `{ approveOffer: approveTaskOfferFn, acceptOffer: acceptOfferFn, placeBid: placeBidFn, acceptLowestTaskBid: acceptLowestTaskBidFn, counterOffer: counterOfferFn }`. Components import no bidding server function themselves. If importing it in a node test fails, stop: the plan is wrong here; do not drop the test.
  - `BidThread({ entries, me }: { entries: readonly ThreadEntry[]; me: number })`: `<ol>`, one line per entry: `<jméno> nabízí|chce <číslo>` (giver side `nabízí`), my own as `Ty nabízíš|Ty chceš <číslo>`; `threadTime(at)` in `text-meta text-muted`; an open entry `font-bold` with the number in `num`; a closed one `text-muted` with its state word. Long names wrap (`break-words`).
  - `useTaskAction().run` accepts `() => Promise<TaskActionResult | LifecycleActionResult>`.
  - `functions.ts` exports `answered(result: Result<TaskRow, TaskError>): TaskActionResult`.

- [ ] **Step 1: Write the failing tests**

```ts
// taskView.test.ts: `view(over)` = TaskView id 1, 'Vyluxovat celý obývák a chodbu', proposed, score 18,
// createdByName/offeredByName 'Táta', approvedBy ['Táta'], approverIds [2], bids [], lowest null, …over;
// `low(score, ...bidders)` builds a `lowest`; b(takerId, name, score) a bid.
const STARSI = { id: 3, role: 'taker' } as const, MLADSI = { id: 4, role: 'taker' } as const
const TATA = { id: 2, role: 'giver' } as const, ADMIN = { id: 1, role: 'admin' } as const
const keys = (bs: { key: string }[]) => bs.map((x) => x.key)

it('chip: proposed, negotiating once someone bid, pending for done_unconfirmed', () => {
  expect([view({}), view({ bids: [b(3, 'Starší', 25)] }), view({ status: 'done_unconfirmed' })].map(taskChipState))
    .toEqual(['proposed', 'negotiating', 'pending'])
})
it('a brother without a bid says yes (open for all); with a bid he picks: his first, then open for all', () => {
  expect(bidButtons(view({}), STARSI)).toEqual([
    { key: 'approve', action: 'approveOffer', data: { taskId: 1, score: 18 }, label: 'Souhlasím', hint: 'Úkol bude volný pro všechny.', variant: 'ok' },
  ])
  const bids = [b(4, 'Mladší', 22), b(3, 'Starší', 25)]
  expect(bidButtons(view({ bids }), STARSI)).toEqual([
    { key: 'take', action: 'acceptOffer', data: { taskId: 1, score: 18 }, label: 'Beru za 18', hint: 'Úkol bude tvůj.', variant: 'ok' },
    { key: 'approve', action: 'approveOffer', data: { taskId: 1, score: 18 }, label: 'Souhlasím', hint: 'Úkol bude volný pro všechny.', variant: 'ghost' },
  ])
})
it('a brother who already said yes is not asked again, bid or not (decision 2)', () => {
  expect(keys(bidButtons(view({ approverIds: [2, 3] }), STARSI))).toEqual([])
  expect(keys(bidButtons(view({ approverIds: [2, 3], bids: [b(3, 'Starší', 25)] }), STARSI))).toEqual([])
})
it('myBid is his own bid, never the other brother\'s or the lowest', () => {
  const both = view({ bids: [b(4, 'Mladší', 22), b(3, 'Starší', 25)], lowest: low(22, { id: 4, name: 'Mladší' }) })
  expect([myBid(both, STARSI), myBid(both, MLADSI)]).toEqual([25, 22])
  const other = view({ bids: [b(4, 'Mladší', 22)], lowest: low(22, { id: 4, name: 'Mladší' }) })
  expect(myBid(other, STARSI)).toBeNull()
  expect(keys(bidButtons(other, STARSI))).toEqual(['approve'])
  expect(waitingMeta(other, STARSI)).toBe('Nabízí Táta')
})
it('who the offer still waits for', () => {
  const brothers = [{ id: 3, name: 'Starší' }, { id: 4, name: 'Mladší' }]
  expect(waitingText(view({ waitingFor: brothers }), TATA)).toBe('Čeká se na: Starší nebo Mladší')
  expect(waitingText(view({ waitingFor: brothers }), STARSI)).toBe('Čeká se na: tebe nebo Mladší')
  expect(waitingText(view({ waitingFor: [] }), TATA)).toBeNull()
  expect(waitingText(view({ status: 'open', waitingFor: brothers }), TATA)).toBeNull()
})
it('a parent accepts the lowest bid as the server sent it: one bidder reserves, a tie opens', () => {
  expect(bidButtons(view({}), TATA)).toEqual([])
  const one = view({ bids: [b(4, 'Mladší', 22), b(3, 'Starší', 25)], lowest: low(22, { id: 4, name: 'Mladší' }) })
  expect(bidButtons(one, TATA)).toEqual([
    { key: 'yes', action: 'acceptLowestTaskBid', data: { taskId: 1, score: 22, bidders: [4] }, label: 'Přijmout 22 (Mladší)', hint: 'Úkol bude rezervovaný pro Mladší.', variant: 'ok' },
  ])
  const tie = view({ bids: [b(3, 'Starší', 22), b(4, 'Mladší', 22)], lowest: low(22, { id: 3, name: 'Starší' }, { id: 4, name: 'Mladší' }) })
  expect(bidButtons(tie, TATA)[0]).toMatchObject({ label: 'Přijmout 22', hint: 'Stejnou cenu chce víc lidí. Úkol bude volný.', data: { bidders: [3, 4] } })
})
it("a parent's counter: a new offer off the bids, an accept exactly on one (decision 8b)", () => {
  const t = view({ bids: [b(4, 'Mladší', 22), b(3, 'Starší', 25), b(5, 'Bratranec', 25)] })
  expect(sendButton(t, TATA, 21)).toMatchObject({ action: 'counterOffer', data: { taskId: 1, score: 21, bidders: [] }, label: 'Nabídnout', hint: 'Nová nabídka pro všechny.', disabled: false })
  expect(sendButton(t, TATA, 22)).toMatchObject({ data: { score: 22, bidders: [4] }, label: 'Přijmout 22 (Mladší)', hint: 'Úkol bude rezervovaný pro Mladší.' })
  expect(sendButton(t, TATA, 23)).toMatchObject({ data: { bidders: [] }, label: 'Nabídnout' })
  expect(sendButton(t, TATA, 25)).toMatchObject({ data: { bidders: [3, 5] }, label: 'Přijmout 25', hint: 'Stejnou cenu chce víc lidí. Úkol bude volný.' })
  expect(sendButton(t, TATA, 18)?.disabled).toBe(true)
  expect(sendButton(view({}), TATA, 30)).toMatchObject({ label: 'Nabídnout', disabled: false }) // decision 8a
})
it("a brother's bid: not the offer, not his own bid again", () => {
  const t = view({ bids: [b(3, 'Starší', 25)] })
  expect([18, 25, 24].map((n) => sendButton(t, STARSI, n)?.disabled)).toEqual([true, true, false])
  expect(sendButton(t, STARSI, 24)).toMatchObject({ action: 'placeBid', data: { taskId: 1, score: 24 }, label: 'Nabídnout' })
})
it('nothing to do once agreed, or for the admin', () => {
  for (const [t, me] of [[view({ status: 'reserved' }), STARSI], [view({ status: 'open' }), TATA], [view({}), ADMIN]] as const) {
    expect(bidButtons(t, me)).toEqual([])
    expect(sendButton(t, me, 30)).toBeNull()
  }
})
it('row and page texts', () => {
  expect(waitingMeta(view({}), STARSI)).toBe('Nabízí Táta')
  expect(waitingMeta(view({ score: 20, offeredByName: 'Máma', bids: [b(3, 'Starší', 25)] }), STARSI)).toBe('Máma 20 · ty 25')
  expect(lowestText(low(22, { id: 3, name: 'Starší' }, { id: 4, name: 'Mladší' }))).toBe('Starší, Mladší chtějí 22')
  const reserved = view({ status: 'reserved', offeredByName: null, reservedBy: { id: 4, name: 'Mladší' } })
  expect([detailMeta(reserved, MLADSI), detailMeta(reserved, STARSI), detailMeta(view({ status: 'open', offeredByName: null }), STARSI)])
    .toEqual(['Je to tvoje', 'Rezervoval Mladší', null])
})
it('thread times are Prague wall clock: Saturday 23:30 UTC is Sunday 00:30', () => {
  expect(threadTime('2026-11-21T09:12:00.000Z')).toBe('so 10:12')
  expect(threadTime('2026-11-21T23:30:00.000Z')).toBe('ne 00:30')
})
it('task id in the URL: plain positive digits only', () => {
  expect(['7', '0', '-1', '1.5', 'abc', '1e3', ' 7', '9007199254740993'].map(parseTaskIdParam))
    .toEqual([7, null, null, null, null, null, null, null])
})
it('toasts: mine, agreed, approved, sent', () => {
  expect([
    toastFor('acceptOffer', 'reserved', STARSI), toastFor('acceptLowestTaskBid', 'reserved', TATA),
    toastFor('approveOffer', 'open', STARSI), toastFor('approveOffer', 'proposed', TATA), toastFor('placeBid', 'proposed', STARSI),
    toastFor('counterOffer', 'proposed', TATA), toastFor('counterOffer', 'open', TATA),
  ]).toEqual(['Domluveno, úkol je tvůj', 'Domluveno', 'Domluveno', 'Schváleno', 'Nabídka odeslána', 'Nabídka odeslána', 'Domluveno'])
})
// bidCalls.test.ts: the five server functions vi.mock'ed (each a vi.fn resolving { ok: true, id: 1, status: 'proposed' }).
it.each([
  { action: 'approveOffer', data: { taskId: 1, score: 18 } },
  { action: 'acceptOffer', data: { taskId: 1, score: 18 } },
  { action: 'placeBid', data: { taskId: 1, score: 24 } },
  { action: 'acceptLowestTaskBid', data: { taskId: 1, score: 22, bidders: [4] } },
  { action: 'counterOffer', data: { taskId: 1, score: 21, bidders: [] } },
] as const)('callBid sends $action to its own server function only, with its data as is', async (call) => {
  await callBid(call)
  const fns = { approveOffer: approveTaskOfferFn, acceptOffer: acceptOfferFn, placeBid: placeBidFn, acceptLowestTaskBid: acceptLowestTaskBidFn, counterOffer: counterOfferFn }
  for (const [action, fn] of Object.entries(fns)) {
    if (action === call.action) expect(fn).toHaveBeenCalledExactlyOnceWith({ data: call.data })
    else expect(fn).not.toHaveBeenCalled()
  }
})
it('every action calls its own server function', () => {
  expect(BID_CALLS).toEqual({ approveOffer: approveTaskOfferFn, acceptOffer: acceptOfferFn, placeBid: placeBidFn, acceptLowestTaskBid: acceptLowestTaskBidFn, counterOffer: counterOfferFn })
})
```

```tsx
// bids.test.tsx (renderToStaticMarkup)
it('BidThread: who, verb, number, time; my own entries say "Ty"; closed entries carry their state word', () => {
  const at = '2026-11-21T09:12:00.000Z'
  const html = renderToStaticMarkup(<BidThread me={3} entries={[
    { id: 1, side: 'giver', by: { id: 2, name: 'Táta' }, score: 18, at, state: 'open' },
    { id: 2, side: 'taker', by: { id: 3, name: 'Starší' }, score: 25, at, state: 'replaced' },
    { id: 3, side: 'taker', by: { id: 3, name: 'Starší' }, score: 23, at, state: 'open' },
  ]} />)
  expect(html).toMatch(/Táta nabízí.*18.*so 10:12.*Ty chceš.*25.*změněno.*Ty chceš.*23/s)
  expect(html).not.toContain('Starší')
  expect(html.match(/změněno|přijato|uzavřeno/g)).toEqual(['změněno'])
  const other = renderToStaticMarkup(<BidThread me={2} entries={[
    { id: 1, side: 'giver', by: { id: 2, name: 'Táta' }, score: 18, at, state: 'open' },
    { id: 4, side: 'taker', by: { id: 4, name: 'Mladší' }, score: 22, at, state: 'accepted' },
  ]} />)
  expect(other).toMatch(/Ty nabízíš.*18.*Mladší chce.*22.*přijato/s)
  expect(other).not.toContain('Táta')
})
it('ScoreStepper: each button is disabled exactly at its end', () => {
  const ends = (value: number) =>
    renderToStaticMarkup(<ScoreStepper value={value} onChange={() => undefined} label="Body" />)
      .split('role="slider"').map((part) => part.includes('disabled=""'))
  expect([1, 2, TASK_SCORE_MAX - 1, TASK_SCORE_MAX].map(ends)).toEqual([[true, false], [false, false], [false, false], [false, true]])
})
```

`taskErrors.test.ts`: rows `['same_score', sameScore]`, `['no_bids', noBids]`, `['no_bid', noBid]`, `['already_approved', alreadyApproved]`.

`bidding.test.ts`: `listTasks` gives `waitingFor` = `[Starší, Mladší]` (ids and names) for Táta's fresh offer and still after Starší bids (a bid is no yes); `[]` once Starší says yes (open) and once a task is reserved. Only givers create tasks (`createTaskFn` is giver-only), so no task waits for the parents.

`functions.test.ts`: `answered` maps `ok(row)` to `{ ok: true, id: row.id, status: row.status }` for `proposed`, `open` and `reserved` rows, and passes `fail('offer_changed')` through unchanged.

- [ ] **Step 2: Run**: `pnpm vitest run src/components/tasks src/lib src/server/tasks/functions.test.ts`. Expected: FAIL (modules and exports missing).
- [ ] **Step 3: Implement** the strings, messages, `taskView.ts`, `bidCalls.ts`, `ScoreStepper` (and switch `novy.tsx`), `BidThread`, the wider `run` type and the `answered` export.
- [ ] **Step 4: Run**: `pnpm vitest run src/components src/lib src/server && pnpm typecheck && pnpm lint`. Expected: PASS (`strings.test.ts` "no empty labels" included).
- [ ] **Step 5: Commit**: `git commit -m "Bid thread, score stepper and the screen logic for bidding"`

### Task 2: The task page and its ways in

**Files:**
- Create: `src/routes/_app/ukol/$taskId.tsx`, `src/components/tasks/BidPanel.tsx`, `src/components/tasks/BidsToAnswer.tsx`, `src/components/tasks/bidPanel.test.tsx`
- Modify: `src/lib/nav.ts`, `src/lib/nav.test.ts`, `src/components/shell/Screen.tsx`, `src/components/tasks/WaitingForYou.tsx`, `src/routes/_app/index.tsx`, `src/routes/_app/ukoly/index.tsx`, `src/routeTree.gen.ts` (generated)

**Interfaces:**
- Consumes: Task 1; `getTaskDetailFn`, `listBidsToAnswerFn`.
- Produces:
  - `nav.ts`: `'/ukol/$taskId'` in `APP_PATHS`, `SCREEN_ROLES['/ukol/$taskId'] = ['taker', 'giver']`; ``export type StaticAppPath = Exclude<AppPath, `${string}$${string}`>`` (every path with a param drops out, not only this one) for `NavItem.to` and `Screen`'s `back`.
  - Route `/ukol/$taskId`: `beforeLoad` → `guardScreen(role, '/ukol/$taskId')`; loader: `parseTaskIdParam(params.taskId)`, `throw notFound()` on null or a null detail, else `getTaskDetailFn({ data: { taskId } })`. Page: `<Screen title={task.title} back="/">`; a `Card` with `StateChip` (`taskChipState`), the score in `num`, `detailMeta`, and when proposed the line `Souhlasí: Táta ✓` from `approvedBy` with `waitingText` under it (`Čeká se na: Mladší`); `SectionLabel` "Vyjednávání" + `BidThread`; `BidPanel`.
  - `BidPanel({ task, me })`: the `bidButtons` stacked full width, each with its hint in `text-meta text-muted` under it; for a brother with a bid, the line "Tvoje nabídka <myBid>" under them. Then the group "Chci jinou cenu" (brother) or "Nová nabídka" (parent): `ScoreStepper` starting at his bid or the offer, then the `sendButton` (variant `primary`) on its own full-width line under the stepper (a long "Přijmout 999 (<name>)" wraps there, never beside the stepper), with its hint. Hidden when `sendButton` is null. Every call goes through `useTaskAction().run(key, () => callBid(b), (r) => toastFor(b.action, r.status, me))`; busy: the tapped button shows `cs.tasks.approving` and `aria-busy`, all are disabled.
  - `WaitingForYou({ items, me })`: chip `taskChipState`, meta `waitingMeta`. No bid of mine: "Souhlasím" (through `useTaskAction().run(key, () => callBid(button), (r) => toastFor(...))` with the `approve` button from `bidButtons`, so the row and the page share one path, one busy state and one toast) and a `ghost` link "Jiná cena" to the page, stacked under each other at the row's right. With my bid: one `ghost` link "Otevřít". The header comment drops "come with bidding, #34".
  - `BidsToAnswer({ items })`: section "Vyjednávání (n)" (mockup GHome) after "Ke schválení" on a parent's Domů; rows `TaskRow` state `negotiating`, points = offer, meta `lowestText(task.lowest)`, action `ghost` link "Odpovědět". Nothing when empty. Home loader adds `bids: await listBidsToAnswerFn()` for parents (`[]` for brothers).
  - `ukoly/index.tsx`: the local `STATE` map becomes `taskChipState`; a proposed row gets a `ghost` link button to the page as its action (44 px, like Domů): "Odpovědět" for a parent when there are bids, else "Otevřít"; its meta becomes `lowestText` when there are bids. The name stays plain text.

- [ ] **Step 1: Write the failing tests**:
  - `nav.test.ts`: add `'/ukol/$taskId': 'taker giver'` to `matrix` and `expect(ROLES.filter((r) => canSee(r, '/ukol/$taskId'))).toEqual(['taker', 'giver'])`.
  - `src/components/tasks/bidPanel.test.tsx` (`renderToStaticMarkup`; mocks as `tasks.test.tsx` does for `ToApprove`: `useTaskAction` → `{ busy: action.busy, run: vi.fn() }`, `./bidCalls` → `vi.fn()`s, `@tanstack/react-router` `Link` → a plain `<a href={to}>`):
    - `BidPanel`, brother with a bid: "Beru za 18" before "Souhlasím", both hints, "Tvoje nabídka 25", and "Chci jinou cenu" with "Nabídnout" still shown (he can change his bid).
    - `BidPanel`, parent with a lowest bid: "Přijmout 22 (Mladší)" and "Nová nabídka"; reserved task: no button at all.
    - `BidPanel`, busy on `take`: that button has `aria-busy="true"` and "Ukládám…", and every `<button>` has `disabled`.
    - `WaitingForYou`: a row without my bid has "Souhlasím" and a link "Jiná cena" to `/ukol/1`; a row with my bid has only "Otevřít" and no "Souhlasím"; meta "Táta 18 · ty 25".
    - `BidsToAnswer`: header "Vyjednávání (1)", meta "Mladší chce 22", link "Odpovědět"; `[]` renders nothing.
- [ ] **Step 2: Run**: `pnpm vitest run src/lib/nav.test.ts src/components/tasks/bidPanel.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the route, `BidPanel`, `BidsToAnswer` and the edits above.
- [ ] **Step 4: Build and check**: `pnpm build` (regenerates `src/routeTree.gen.ts`), then `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm format:check`. Expected: PASS; `tests/screen-guards.test.ts` finds the new route's guard.
- [ ] **Step 5: Walk it in the real app at 360 px** (`TASKMASTER_ENV=preview DATA_DIR=$(mktemp -d) pnpm dev`; the demo has "Umýt auto" 18 with Starší 25 and Mladší 22, and "Uklidit sklep" 10). Create "Vyluxovat celý obývák a chodbu" for 12 as `tata`. As `starsi`: Domů row shows "Jiná cena" and the long name on two lines; on the page bid 14, then see "Beru za 12" over "Souhlasím", each with its hint, and "Čeká se na: tebe nebo Mladší". Úkoly: the row has "Otevřít". As `tata`: Domů → "Vyjednávání" lists both tasks with "Mladší chce 22" in full; on "Umýt auto" move the stepper to 25: button reads "Přijmout 25 (Starší)"; back to 22 and tap "Přijmout 22 (Mladší)". As `mladsi`: "Umýt auto" under "Moje", page says "Je to tvoje". As `starsi`: page shows "Rezervoval Mladší", his bid "uzavřeno", no buttons. Then tap a stale yes: open a page as `starsi`, as `tata` counter it in another tab, tap "Beru" as `starsi`: Czech "Cena se mezitím změnila" and the fresh page. No horizontal scroll anywhere. If a row cuts the name or the meta, stack its action under the text (`TaskRow` `className`) before committing.
- [ ] **Step 6: Commit**: `git commit -m "Task page with the bid thread, and the ways into it"`
