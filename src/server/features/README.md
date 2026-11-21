# Launch switches

Which unfinished features the family sees (`Features` in [`src/lib/features.ts`](../../lib/features.ts)).
One row per switch in the `feature_flags` table; the migration seeds the launch values (all off).

- `flags.ts`: `getFlags(db)`. A switch with no row reads as off; an unknown row is ignored.
- `functions.ts`: `getFeaturesFn`, signed-in users only. The app shell (`src/routes/_app.tsx`)
  calls it once per page load (cached in the browser for an hour, `src/lib/clientCache.ts`) and
  hands screens `context.features`.

No admin screen yet. Flip a switch in the database; a page reload picks it up (an open app within the hour), no
restart:

The image has no `sqlite3`, so use Node's built-in SQLite inside the running container
(`<container>` is its name; `/data` is `DATA_DIR` in the image):

```sh
docker exec <container> node --no-warnings -e "
  const db = new (require('node:sqlite').DatabaseSync)('/data/taskmaster.db')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(\"UPDATE feature_flags SET enabled = 1 WHERE key = 'recurring'\")
  console.table(db.prepare('SELECT key, enabled FROM feature_flags').all())"
```

With `sqlite3` on hand (dev: `.data/taskmaster.db`):
`sqlite3 .data/taskmaster.db "UPDATE feature_flags SET enabled = 1 WHERE key = 'recurring'"`.

`enabled` takes only `0` or `1` (a CHECK refuses anything else). A new switch: add its key to
`FEATURE_KEYS` and seed its row (off) in a new migration.

Previews start from the same migrations, so every switch is off there too. A PR that finishes a
feature and should show it on its preview turns the switch on in a new migration; that
migration also turns it on in production when the PR merges, so it belongs in the PR that
releases the feature.
