import { definePlugin } from 'nitro'
import { databasePath, getDb } from '~/server/db'
import { familyConfigPath, seedUsersFromFile } from '~/server/users'

// Boot: open the database and apply pending migrations before the first request is served.
// A failed migration throws here, so the server never runs on a half-migrated schema.
// Then apply the family config (people), if there is one; an invalid config also stops boot.
export default definePlugin(() => {
  const db = getDb()
  console.info(`[db] ready at ${databasePath()}`)
  const seeded = seedUsersFromFile(db)
  if (!seeded) {
    console.warn(`[users] no family config at ${familyConfigPath()}; nobody can log in yet`)
  } else {
    console.info(
      `[users] family config applied: ${String(seeded.created.length)} created, ${String(seeded.updated.length)} updated`,
    )
  }
})
