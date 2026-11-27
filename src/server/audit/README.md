# Audit log (spec §5.10)

Every state change writes its audit entry **in the same transaction** (CLAUDE.md hard rule).

```ts
import { withAudit } from '~/server/audit'

const task = withAudit(
  getDb(),
  (tx) => tx.insert(tasks).values(input).returning().get(), // all writes go through `tx`
  (task) => ({
    actor: { kind: 'user', userId: session.userId },
    action: 'task.created',
    entityType: 'task',
    entityId: task.id,
    after: task,
  }),
)
```

- The change must be synchronous (better-sqlite3); `withAudit` throws on an async one.
- One change, several entries (e.g. settlement per taker): return an array of entries.
- Already inside a transaction: `writeAudit(tx, entry)`.
- Actors: `{ kind: 'user', userId }`, `{ kind: 'system' }` (scheduler), `{ kind: 'anonymous' }` (failed login).
- `before` / `after` are stored as JSON. `before` is omitted (or null) for creations, stored as SQL NULL; `after` holds the new values or the action's payload. `reason` is optional (required by some rules, e.g. corrections; the caller enforces that).
- `entityType` comes from the closed `ENTITY_TYPES` list in `actions.ts`; add new ones there.
- Recurring instances are rows of `tasks` and log with entity type `task`. Their birth is `instance.created` (on demand, scheduled) or `instance.self_logged`, the scheduler's expiry `instance.expired`; every other step on them is the `task.*` action of a one-time task.
- Credentials never reach the log: keys like `password`, `pin`, `token`, `secret`, `credential` are replaced with `[redacted]` at any depth. A failed login logs only the normalised username, never what was typed as a password.
- `at` defaults to the server clock; never pass a time that came from a request.
- New action type: add it to `actions.ts`. Never rename or remove one; old rows keep it.
- Changes (#299): `change_id` groups the entries of one change. **One change is one synchronous run** of server code: one tap's server function, nested `tx.transaction` savepoints included, or one scheduler tick (rolling periods and expiring copies in one tick is one change). `writeAudit` sets it: the run's first entry gets `NULL`, every later one that first entry's id; a microtask after the first write ends the run, so the next request starts a new change. A change's key is `change_id ?? id`. The run's first entry is kept per request, in the scope the request middleware opens (`src/server/live/changeScopeMiddleware.ts`, `inChangeScope` in `changeScope.ts`), so two requests whose runs fall in one tick never share a change (#304); outside a request (the scheduler) a module-level holder does the same. A request that writes, awaits, then writes again is two changes. If a run's first entry is rolled back, the next entry starts the change again: the first entry is checked by its id, action, entity and time, since a rolled-back id can be taken by another request's row. The run ends with the microtask queued at its first write, so a write from a microtask queued earlier in the same turn (before that first write) still joins the run; that is harmless, it only makes one change of two.
- Listening: `onAuditWritten(listener)` hears every insert synchronously (id and change id), inside the writer's transaction; read the log only after the run (in a microtask), when a rolled-back entry no longer exists. A throwing listener is logged and never breaks the write. The live hub (`src/server/live/`) is its one user; this module imports nothing of HTTP or the hub.
- The table is append-only: DB triggers reject `UPDATE` and `DELETE`. There is no code path to edit or delete entries.
- Reading: `entityLog(db, entityType, entityId)` returns one entity's entries, oldest first (e.g. a task's history, #36). Map what a screen needs from it; never send `before` / `after` to a client as they are. The task history (`src/server/tasks/history.ts`) reads the `after` keys `score` and `reservedBy` of task entries: keep those names when writing task entries. The task page (`threadFrom` in `src/server/tasks/tasks.ts`) reads `biddingFrom` of the newest `task.bidding_reopened` to hide earlier rounds (#212).
