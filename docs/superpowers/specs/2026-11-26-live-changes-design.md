# Live change notices: design

Status: design, approved by Jakub 2026-11-26 (thread "Brainstorm live change notifications").

## Intent

You look at a screen for a while (a task page, Týden, the meeting). Someone else changes
something that screen shows. Today you have no idea until you act and the server refuses a stale
action. Jakub wants the server to tell the screen, as it happens, that its data is out of date,
and the person to decide when to update it.

The notice informs; it never acts. Updating the screen by itself could throw away what someone
has half typed, which is worse than stale data.

## Goals

- **Push, event-driven.** The server sends an event the moment a change commits. No polling.
- **Scope = everything the screen loaded**, whether it is in view or scrolled away. A change to
  something the screen did not load gives no notice.
- **Banner at the top**, in the place and style of today's success toasts (Sonner, top centre):
  - one change: who did what, e.g. "Táta schválil Vynést koš", and a refresh icon;
  - another change while the banner shows: it becomes "Více změn (2)" and keeps counting up,
    with the same refresh icon.
- The banner **stays** until the person taps refresh, leaves the screen, closes it, or swipes it
  up (Sonner's swipe to dismiss).
- **The count runs from the last refresh.** Dismiss the banner without refreshing, and the next
  change brings it back as "Více změn (3)": the screen is three changes behind, not one
  (Jakub).
- **Refresh updates the screen in place**: the screen's data is loaded again
  (`router.invalidate()`, as after one's own action), not a browser reload. Typed inputs stay.
- **Own changes:** a change made in this same tab gives no notice (the tab already updates after
  its own action). A change the same person makes on another phone or tab does (Jakub).
- **Scheduler changes count** (a copy expires, new copies appear), shown with the scheduler as
  actor **[call]**.
- **Missed changes are caught up.** A phone that slept or lost the connection gets, when it
  reconnects, the changes it missed, so after a lunch break the banner says "Více změn (4)".

## Non-goals

- Push notifications to a closed app (the spec's separate stretch goal, `web-push`).
- Updating a screen without the person's tap; merging new data into a half-filled form.
- Launch switch flips. Those keep the hourly browser cache (`src/lib/clientCache.ts`); after a
  flip the PWA is fully reopened, as today **[call]**.
- A "connection lost" indicator **[call]**: the server still refuses stale actions as today.
- A list of what changed. One change shows its sentence; several show only the count.

## Anti-goals (a failure even if it works)

- **A notice reveals data the person may not see.** A boy's phone must never receive an event,
  or its text, about something only a parent or the admin may load (Jakub: why approach B was
  rejected).
- **Load on the server grows with every change × every phone** (Jakub: why approach C was
  rejected). An event costs one small message to the phones whose screens read it, nothing else.
- **A missed notice that looks like no change.** A change to loaded data that silently gives no
  banner is the bug to design against (see Drift, below).
- The banner steals focus, covers the field being typed into, or makes the screen jump.

## Approaches

Transport for all three: Server-Sent Events from the one server.

- **A. The screen subscribes to what it read (picked by Jakub).** Each screen's load returns a
  short list of "topics" it read, and opens the stream with that list (Jakub's "query"). Each
  change is mapped to the topics it touches, and the server sends it only to matching
  subscriptions. Precise and light. Risk: a topic missed on either side means a silent miss,
  handled by the tests under Drift.
- **B. Broadcast every change; the phone checks ids.** Rejected: every phone gets every change,
  including what its user may not see, and "is it on my screen" is fuzzy (a week total changes
  without the task being listed).
- **C. Broadcast a nudge; the phone reloads its screen in the background and compares.**
  Rejected: one extra load per change per open phone, and a burst of changes multiplies it.
- WebSockets instead of SSE: rejected. Events only flow one way, and the Apache proxy in front
  of production would need a tunnel module and rewrite rules. SSE is an ordinary HTTPS response
  that stays open, so it uses the same TLS, cookie and proxy as every other request; production
  serves it over HTTPS only (Jakub asked).
- Polling: rejected by "event-driven".

## Design

### The query (subscription)

- **The server writes the query, not the phone [call].** Every data function a screen loader
  calls returns, next to its data, the topics it read and the newest audit id at the moment it
  read (`asOf`). The loader joins them; the screen opens the stream with the union of topics and
  the smallest `asOf`.
- **Topics are per viewer where the data is [call].** What a person may see is decided per row
  today, not only per role: Týden shows a boy only his own row (`getWeek`), disputes have
  `visibleTo`, a proposed template is hidden from the boys. So a topic names the slice its
  reader may see, e.g. `period:<id>:taker:<id>` for a boy, `dispute:<id>` only for those who see
  that dispute. The stream endpoint checks every topic with the same read rule the data function
  used and refuses one the user could not have loaded, so a crafted query gains nothing. The hub
  itself only matches strings: no reads per event.
- **Leaving a screen ends its subscription (Jakub).** On navigation the tab closes the old
  stream and opens one with the new screen's topics and `asOf`; the banner and its count are
  cleared. Nothing about the old screen is delivered after that: each stream carries the id of
  its subscription, and an event from a closed one that was already in flight is dropped by the
  tab. A refresh does the same with the same screen's new topics. One open stream per tab.

### Topics [call]

Coarse on purpose: fewer, broader topics mean fewer ways to miss one. The builder fixes the exact
list; the shape is:

- one per thing with its own page: `task:<id>` (a one-time task or a copy, with its bids,
  thread and history), `template:<id>`;
- one per derived view: `period:<id>` (Týden, the meeting, week totals and settlement),
  `points:<takerId>` (a boy's totals);
- one per list or admin area: `tasks` (Úkoly, Home's lists), `templates`, `people`, `settings`,
  `proposals`, `disputes`, `suggestions`.

Over-firing (a notice for a change that turns out not to alter what is shown) is acceptable;
missing is not.

### The change side

- `withAudit` / `writeAudit` already record every state change with its action, entity type and
  id, in the same transaction. **One shared function maps an audit entry to its topics**, e.g.
  `task.approved` on task 12 → `task:12`, `tasks`, `period:<its period>`,
  `points:<its taker>`. Nobody maps topics per call site.
- After the transaction commits, the entry goes to an in-process hub (one server, one process),
  which sends it to every open stream whose topics intersect and whose user may see it.
- **The event id is the audit entry id.** On reconnect (the browser's `Last-Event-ID`, or `asOf`
  on a fresh stream) the server replays newer audit entries that match, from the audit table.
  The hub keeps no history of its own.

### The event

- **The text comes from the action type (Jakub).** Every audit action type already says exactly
  what changed (`task.agreed`, `instance.expired`, …). Each gets a Czech translation in
  `src/lib/strings.ts`, and the banner shows the actor, that translation and the title, e.g.
  "Táta · domluveno za 8 b · Vynést koš". Task and chore actions reuse the wording of the task's
  Historie (`cs.history`), which already translates them and shows the same points to whoever
  can open the task; the other actions (periods, proposals, settlement, people, settings,
  disputes, suggestions) get new translations, with the fallback "změna" as Historie does. Never
  the entry's `before` / `after` as they are (audit README rule): only the values that
  translation needs, and only values the subscriber's screen could load.
- **One change = one action of a person [call].** One tap can write several audit entries (a
  settlement writes one per boy; accepting a bid writes more than one). Those count as one
  change, with the sentence of the main entry. How entries of one transaction are grouped
  (a change id on the entries, or similar) is left to the builder; adding a column is a schema
  change and goes through the normal review.
- Own-tab changes: each tab has an id, sent with its server calls; the live event carries the
  originating tab id (not stored in the audit log), and that tab ignores it. Replayed events have
  no tab id **[call]**: a tab that made a change and then lost the connection before the event
  arrived may see its own change counted once, which is harmless.

### The banner

- One Sonner toast with a fixed id, updated in place: no timeout, swipe up or close to dismiss,
  refresh icon button (`aria-label` "Načíst změny" **[call]**).
- The count lives in the tab and resets on refresh and on navigation.
- Placement and keyboard: the banner sits at the top and must not cover the field being typed
  into (CLAUDE.md phone keyboard rule); `e2e/keyboard.spec.ts` gets a case with the banner up.

### Connection and limits

- Auth: the session cookie, as every request (frames on `/dev/multi` pass `tmFrame`).
- Heartbeat comment every 25 s **[call]**: production's Apache proxy closes idle requests after
  60 s (`ProxyTimeout 60`).
- The stream must not be buffered by Apache (likely `flushpackets=on` on the `ProxyPass`, and no
  compression of `text/event-stream`). That is a change on the VPS: it needs Jakub's own words
  before anyone applies it. The preview host's proxy needs the same check.
- **Limits from the real app (Jakub: based on how it looks and what the data is).** With the
  topics above, a screen subscribes to a handful of topics, not one per row: lists and Týden use
  `tasks` and `period:…` instead of one topic per task. Counted per screen today (topics ≈):
  Domů 4–5, Úkoly 2–3, Zapsat 1, task page 2–3, chore page 2–3, Týden 2–3, Příští / Výchozí
  týden 2, Profil 1–2, Schůzka about 7 (the week, tasks, proposals and each boy's points),
  Správa about 10 (people, settings, disputes, suggestions, corrections and each boy's points).
  The builder recounts from the code; the limit is **twice the largest screen's count** (about
  20 today), checked by a test over every screen, so a new screen that grows past it fails CI
  rather than being refused in use. A boy's or Mum's account adds a topic per person on the
  screens that list everyone, which the 2× covers.
- **Streams per login:** a login is one device (a phone, the PWA, a browser), and each open tab
  holds one stream. In practice that is one or two. The limit is 3 per session **[call]**; when
  a fourth opens, the server closes the oldest instead of refusing the newest, so the tab in
  hand always works. `/dev/multi` frames each have their own login, so they don't share it.
- A phone in the background drops the stream; the browser reconnects when it comes back, and
  catch-up does the rest.
- Behind a launch switch `liveChanges`, off in production until Jakub flips it. Off: no stream is
  opened, nothing changes.

### Drift (how a silent miss is prevented)

- Every action type in `src/server/audit/actions.ts` must have a topic mapping; a unit test
  fails when a new action has none. "No topics" is a valid, explicit mapping for actions no
  screen loads (login, logout, failed login), and for what Jakub put out of scope: launch switch
  flips and passkeys (`passkey.*`).
- Per screen, a test changes each kind of entity its loader reads and checks that the screen's
  topics catch the event.
- One e2e: two browser contexts, a change in one, the banner and its count in the other, refresh
  keeps a half-typed input.

## Spec changes (in the spec PR)

- §2 Non-goals: "No in-app notifications beyond what is visible when a user opens the app"
  becomes: no notifications beyond badges/counts and the live change banner (this doc).
- §5.12 At the meeting: "the giver's screen updates when reloaded [call]" becomes: the giver's
  screen shows the live change banner and updates on tap.
- §7: a bullet for the banner. §11: SSE for live changes.

## Left to the builder

- The exact topic list and the mapping per action.
- How data functions return topics and `asOf` alongside their data.
- The Czech sentence per action type (UX judge reviews).
- How the work splits into stacked PRs (likely: hub, stream and mapping first; then screens and
  banner).
