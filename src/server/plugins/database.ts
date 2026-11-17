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
})
