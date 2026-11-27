# Live changes (#299)

The server side of the live change banner (design: `docs/superpowers/specs/2026-11-26-live-changes-design.md`).
A screen that is open while someone else changes what it shows gets an event; the banner
(PR 2) tells the person, and they refresh when they choose. Behind the launch switch
`liveChanges` (off in production; the `demo` seed turns it on). Off: the stream answers 404
and data functions return `live: null`.

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

A data function is a `liveRead` (`define.ts`) in its module: `read` (synchronous) and `topics`
(what the viewer was shown). Its server function's handler is `serveLive(def, context.user,
data)`, which reads, then signs the topics in the same synchronous block, and returns
`{ data, live }`: `live` is a token signed with the request's session token (HMAC-SHA256) and
`asOf`, the newest audit id, or null (switch off, no session, no topics). No `await` can fall
between the read and `asOf`, so no change is missed. The token carries the viewer's id and role
(`{ u, r, t, a }`). `serveLive` is the only way to subscribe. Only issue a topic the function
checked the viewer may read: the stream trusts what the server signed. More than `TOPIC_LIMIT`
topics from one function throws outside production; in production it is logged
(`[live] subscription refused: <n> topics, limit 50`) and the screen loads without a banner.

A loader takes the data with `liveSubs()` (`src/lib/liveSubs.ts`) and returns the screen's
subscriptions as `live: LiveSub[]`, for the client's stream.

A `functions.ts` imports `liveRead` from `define.ts` and `idTopic` from `topics.ts` (no
server-only imports: its definitions stay in the client bundle, only handlers are stripped) and
`serveLive` from `read.ts`, used only inside handlers. Never the `~/server/live` index, which
pulls in the hub.

### Topics per data function

Who holds what (`R` = one per row of the returned data; `-` = the role does not call it).
`src/server/live/screens.test.ts` keeps it honest: every loader's calls have a row there, each
screen's union stays at or under `TOPIC_LIMIT` on the demo data (today at most 8, Týden for a
parent), and per screen and role the changes it must show reach it and a brother's facts do not.

| Data function                                                                      | giver                                                                                      | taker                                                                | admin                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------- |
| `listPendingApprovalsFn`, `listScoreChangesWaitingFn`                              | `tasks`                                                                                    | `tasks`                                                              | -                         |
| `listTasksFn`, `listPlanTasksFn`, `listBidsToAnswerFn`, `listPendingCompletionsFn` | `tasks`                                                                                    | -                                                                    | -                         |
| `listBoardFn`                                                                      | -                                                                                          | `tasks`                                                              | -                         |
| `getTaskDetailFn` (null → none)                                                    | `task:<id>`, + `template:<templateId>` for a copy when the chore page loads for the viewer | same                                                                 | same                      |
| `listTemplatesFn`                                                                  | `templates`, `templates:proposed`                                                          | `templates`                                                          | -                         |
| `listPendingTemplatePriceChangesFn`                                                | `templates`, + `templates:proposed` with `choreBidding`                                    | `templates`                                                          | -                         |
| `listPendingTemplateApprovalsFn`                                                   | `templates:proposed`                                                                       | `templates:proposed`                                                 | -                         |
| `getTemplateDetailFn` (null → none)                                                | `template:<id>`                                                                            | same                                                                 | same                      |
| `listLoggableTemplatesFn`                                                          | -                                                                                          | `templates`, `tasks`                                                 | -                         |
| `listDescriptionChangesWaitingFn` (off → none)                                     | -                                                                                          | `tasks`, `templates`                                                 | -                         |
| `getProposalsFn` (off → none)                                                      | `proposals`                                                                                | `proposals`                                                          | -                         |
| `getPointsFn`                                                                      | `people`, `points:<id>` R                                                                  | `points:<self>`                                                      | -                         |
| `getWeekFn`                                                                        | `week`, `people`, `points:<id>` R, + `disputes:about:<id>` R with `disputes`               | `week`, `points:<self>`, + `disputes:about:<self>` with `disputes`   | -                         |
| `getDisputeListFn` (off → none)                                                    | `disputes`                                                                                 | `disputes:by:<self>`, `disputes:about:<self>`, `disputes:about:none` | -                         |
| `getWeekPlanFn` (off → none)                                                       | `week`, `templates`, `tasks`                                                               | same                                                                 | -                         |
| `listMySuggestionsFn` (off → none)                                                 | `suggestions:by:<self>`                                                                    | same                                                                 | same                      |
| `getMeetingFn`                                                                     | `week`, `people`, `points:<id>` R (only with a week to settle)                             | -                                                                    | -                         |
| `listUsersFn`                                                                      | -                                                                                          | -                                                                    | `people`                  |
| `getPeriodDefaultsFn`                                                              | -                                                                                          | -                                                                    | `settings`                |
| `getAdminDisputesFn` (off → none)                                                  | -                                                                                          | -                                                                    | `disputes`                |
| `getFixableFn` (off → none)                                                        | -                                                                                          | -                                                                    | `people`, `points:<id>` R |
| `getAdminSuggestionsFn` (off → none)                                               | -                                                                                          | -                                                                    | `suggestions`             |
| `getItemMarkFn`                                                                    | none: a mark's changes fire its page topic (`mapping.ts`), which the page holds            |                                                                      |                           |

Out of scope (Jakub 2026-11-26): launch switches, passkeys and logins. Profil's
`getPasskeysEnabledFn` and `listMyPasskeysFn`, Správa's `listPasskeyCountsFn` and
`getFeaturesFn`, Klíč and Nový issue no topics; a screen with no topics opens no stream (Profil
with `suggestions` off).

**Why a taker holds `templates:proposed`.** His Čeká na tebe shows every proposed chore waiting
for the takers (`templateWaitsFor`); usually that is every proposed chore, since the creating
giver's yes is written at creation and one taker's yes agrees it. A chore can leave the boys'
lists while still proposed: approvals count only active parties, so once its giver is
deactivated or made a taker, a boy's yes leaves it proposed, waiting for a giver. Every entry
that can then be written on it puts it back on their lists (a description change, a counter, a
turn-down start a new offer round), agrees it (a giver's yes), happens under `choreBidding`,
where a boy loads every proposed chore's page (bids), or is the other boy's yes from a screen
loaded before his brother's (both boys have then said yes to it, so both saw it).
`template.updated` and `template.cancelled` are never written on a proposed chore. A people
change can bring it back with no chore entry, so `user.created` and `user.updated` also fire
`templates:proposed` while any template is proposed (`mapping.ts`). The tests: the last two
blocks of `screens.test.ts`. (The design's "a proposed template is hidden from the boys" is
looser than the code; this follows the code.)

## The stream

`GET /api/live?t=<token>&t=<token>…&since=<asOf>&tab=<tabId>` (`src/routes/api/live.ts`,
core in `stream.ts`); a viewer frame adds `tmFrame`. `Last-Event-ID`, when sent, wins over
`since`, and the start is never older than the tokens' smallest `asOf`.

- 404 switch off; 401 no session, no token, or any token that fails, is another user's or was
  signed for another role of this user (a parent made a boy, or the reverse); 400 more than
  `TOPIC_LIMIT` (50) distinct topics, no `tab`, or a `since` / `Last-Event-ID` that is not a
  non-negative integer; 503 the hub is full; else 200 `text/event-stream`. A 400 for the topic
  count is logged (`[live] stream refused: <n> topics, limit 50, role <role>`, the server log;
  no ids, tokens or key): that screen gets no banner.
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
