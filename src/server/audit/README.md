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
- The table is append-only: DB triggers reject `UPDATE` and `DELETE`. There is no code path to edit or delete entries.
- Reading: `entityLog(db, entityType, entityId)` returns one entity's entries, oldest first (e.g. a task's history, #36). Map what a screen needs from it; never send `before` / `after` to a client as they are. The task history (`src/server/tasks/history.ts`) reads the `after` keys `score` and `reservedBy` of task entries: keep those names when writing task entries. The task page (`threadFrom` in `src/server/tasks/tasks.ts`) reads `biddingFrom` of the newest `task.bidding_reopened` to hide earlier rounds (#212).
