import { definePlugin } from 'nitro'
import { databasePath, getDb } from '~/server/db'

// Boot: open the database and apply pending migrations before the first request is served.
// A failed migration throws here, so the server never runs on a half-migrated schema.
export default definePlugin(() => {
  getDb()
  console.info(`[db] ready at ${databasePath()}`)
})
