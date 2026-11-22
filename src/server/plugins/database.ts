import { definePlugin } from 'nitro'
import { databasePath, getDb } from '~/server/db'
import { describeDemo, seedDemo } from '~/server/demo'
import { describePasskeys, passkeyConfig } from '~/server/passkeys/config'
import { startPeriodRoller } from '~/server/periods'
import { bootstrapAdmin, describeBootstrap } from '~/server/users'

// Boot: open the database and apply pending migrations before the first request is served.
// A failed migration throws here, so the server never runs on a half-migrated schema.
// Then, in a preview (TASKMASTER_ENV=preview), fill an empty database with demo data (#62);
// otherwise create the first admin from ADMIN_PASSWORD if there is none yet (spec §6). Demo
// first: it brings its own admin, so the bootstrap then has nothing to do or warn about.
// Last, once every config check has passed, start the period roller (spec §5.8): it rolls the
// first period or catches up missed cutoffs now, then at each cutoff. Its failures are logged
// and retried, never thrown. Nitro's `close` hook stops it, so a dev reload leaves no second loop.
export default definePlugin((nitroApp) => {
  const db = getDb()
  console.info(`[db] ready at ${databasePath()}`)
  const demo = describeDemo(seedDemo(db))
  if (demo) console.info(demo)
  const message = describeBootstrap(bootstrapAdmin(db))
  if (message) console.warn(message)
  // An invalid WEBAUTHN_* config throws here: the server must not run with broken passkeys.
  console.info(describePasskeys(passkeyConfig()))
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.TASKMASTER_ENV !== 'preview' &&
    process.env.TRUST_PROXY !== '1'
  ) {
    // Behind a reverse proxy every login would share the proxy's IP in the rate limit.
    console.warn(
      '[auth] TRUST_PROXY is not 1: the per-IP login limit sees the proxy, not the client',
    )
  }
  const roller = startPeriodRoller(db)
  nitroApp.hooks.hook('close', () => {
    roller.stop()
  })
})
