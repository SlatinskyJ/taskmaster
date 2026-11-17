import { definePlugin } from 'nitro'
import { databasePath, getDb } from '~/server/db'
import { bootstrapAdmin, describeBootstrap } from '~/server/users'

// Boot: open the database and apply pending migrations before the first request is served.
// A failed migration throws here, so the server never runs on a half-migrated schema.
// Then create the first admin from ADMIN_PASSWORD if there is none yet (spec §6).
export default definePlugin(() => {
  const db = getDb()
  console.info(`[db] ready at ${databasePath()}`)
  const message = describeBootstrap(bootstrapAdmin(db))
  if (message) console.warn(message)
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
})
