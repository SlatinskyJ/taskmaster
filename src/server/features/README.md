# Launch switches

Which unfinished features the family sees (`Features` in [`src/lib/features.ts`](../../lib/features.ts)).
One row per switch in the `feature_flags` table; the migration seeds the launch values (all off).

- `flags.ts`: `getFlags(db)`. A switch with no row reads as off; an unknown row is ignored.
- `functions.ts`: `getFeaturesFn`, signed-in users only. The app shell (`src/routes/_app.tsx`)
  calls it on every navigation and hands screens `context.features`.

No admin screen yet. Flip a switch in the database; the next page load picks it up, no restart:

```sh
sqlite3 "$DATA_DIR/taskmaster.db" "UPDATE feature_flags SET enabled = 1 WHERE key = 'recurring';"
sqlite3 "$DATA_DIR/taskmaster.db" "SELECT key, enabled FROM feature_flags;"
```

`enabled` takes only `0` or `1` (a CHECK refuses anything else). A new switch: add its key to
`Features` and `FEATURE_KEYS`, and seed its row in a new migration.
