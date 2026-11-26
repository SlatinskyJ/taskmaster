# Live changes (#299)

The server side of the live change banner (design: `docs/superpowers/specs/2026-11-26-live-changes-design.md`).
A screen that is open while someone else changes what it shows gets an event; the banner
(PR 2) tells the person, and they refresh when they choose. Behind the launch switch
`liveChanges` (off in production; the `demo` seed turns it on). Off: the stream answers 404
and `liveSubscription` returns `null`.

## What fires an event

Every audit write (`writeAudit`, `withAudit`): `~/server/audit` calls `onAuditWritten`, and
the hub (`hub.ts`) reads the new rows in a microtask, after the synchronous run that wrote them.
By then the transaction has committed or rolled back; a rolled-back row no longer exists, so it
sends nothing. Entries are grouped into changes by `change_id` (audit README: one change is
one synchronous run, e.g. one tap or one scheduler tick). One change is one event per stream.

- `mapping.ts`, `topicsOf`: the one place that maps an audit entry to its topics, from the
  entity's current row. `MAPPED` lists every action (`none` for logins, passkeys and launch
  switch flips); a new action without a row fails typecheck and the test.
- Per stream, the event's `action`, `entityType`, `entityId` and `actor` are those of the
  change's first entry whose own topics the stream has, never of an entry it did not subscribe
  to. `id` is the change's newest audit id (the SSE id), `change` its key. Never `before` /
  `after`.
- The tab that made the change is skipped (`x-tm-tab`, sent by every server function call from
  a tab, `src/lib/tab.ts`); the same person's other tabs and phones get it. Replayed events
  have no tab.

## Topics

`topics.ts` has the list and the rule: a broad topic (`disputes`, `suggestions`,
`templates:proposed`) is only for viewers who may load every row of it; a viewer who may load a
slice subscribes to the slice topics. A change fires the broad topic and every slice it belongs
to. Over-firing is accepted; a miss is not.

## Subscribing (data functions, PR 2)

A data function returns, next to its data, `liveSubscription(user, topics)`: a token signed
with the request's session token (HMAC-SHA256) and `asOf`, the newest audit id. Call it
**before** the function's reads, or in the same synchronous block, so a change committed during
an `await` is never between `asOf` and the data (an early `asOf` only over-fires). Only issue a
topic the function checked the viewer may read: the stream trusts what the server signed.

## The stream

`GET /api/live?t=<token>&t=<token>…&since=<asOf>&tab=<tabId>` (`src/routes/api/live.ts`,
core in `stream.ts`); a viewer frame adds `tmFrame`. `Last-Event-ID`, when sent, wins over
`since`, and the start is never older than the tokens' smallest `asOf`.

- 404 switch off; 401 no session, no token, or any token that fails or is another user's; 400
  more than `TOPIC_LIMIT` (20) distinct topics, no `tab`, or a `since` / `Last-Event-ID` that
  is not a non-negative integer; 503 the hub is full; else 200 `text/event-stream`.
- Body: the catch-up from the audit log (at most 100 changes; more become one
  `event: overflow`, whose id is the newest one), then live events as
  `id: <id>\ndata: <LiveEvent JSON>\n\n`.
- Heartbeat: a `: ping` comment every **25 s**, because production's Apache closes requests
  idle for 60 s (`ProxyTimeout 60`). Each ping checks the session again without sliding it:
  logged out or expired, the stream ends.
- Limits: 3 streams per session (a fourth closes the oldest, so the tab in hand works), 50 in
  all.

## Ops

SSE is an ordinary HTTPS response that stays open: no WebSocket, no proxy module. Production's
Apache likely needs `flushpackets=on` on the `ProxyPass`, and no compression of
`text/event-stream`, or events wait in its buffer. That is a change on the VPS: it needs Jakub's
own words first, and is not part of this code. The preview host's proxy needs the same check.
