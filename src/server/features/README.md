# Launch switches

Which unfinished features the family sees, and rules that can be turned off by hand (`Features` in [`src/lib/features.ts`](../../lib/features.ts)).
One row per switch in the `feature_flags` table. Migrations 0017 and 0019 seed them off for
the launch; 0022 turns every one on (all five features built). 0024 adds `disputes`
(disputes and corrections, #46–#48), off. 0027 adds `settleLastDay` (settle the running week
only on its last day, #211), on: Jakub asked for it to be flipped at merge.
0028 adds `passwordChange` (changing your own password on Profil, #210), off.
0029 adds `bidRefusals` (a brother's Nechci and a parent's turn-down in bidding, #208), off.
0030 adds `approveAnywhere` (approve from the task page and Úkoly, #206), off.
0031 adds `reopenBidding` (reopening bidding on an open one-time task, #212), off.
0032 adds `choreBidding` (bidding on a proposed recurring chore's first price, #209), off.
0033 adds `openRows` (rows open their task or chore page, #205), off.
0037 adds `descriptions` (descriptions on tasks and chores, #207), off.
0039 adds `weekPlan` (a copy for every day of the week, #257), off. Turning it off drops the day
rules of existing copies on the next scheduler tick, so leave it off for one tick (15 min)
before turning it on again.
0040 adds `suggestions` (in-app suggestions, #247), off.
0041 adds `liveChanges` (live change notices: the event stream, #299), off.

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

Previews and e2e servers run the demo seed (`TASKMASTER_ENV=preview`, `src/server/demo/`).
Each named seed lists the switches it turns on and turns every other one off (`setSwitchesIn`,
audit-logged as `feature.switched`), whatever the migrations left: `demo`, which previews get,
turns every switch on, so a feature behind a switch shows on its PR's preview with nothing to flip;
each e2e suite's seed turns on only what that suite needs (`launch`: none). Production never runs that seed: its switches keep the migration's values. Turning a
feature on in production is Jakub's call: by hand as above, or in a migration that belongs only
in the PR that releases the feature (it flips production when that PR merges).
