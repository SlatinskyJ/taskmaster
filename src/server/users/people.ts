import { asc } from 'drizzle-orm'
import type { Person } from '~/domain'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { users } from '~/server/db/schema'

/** Everyone, as the domain sees them (spec §3). Inactive people stay in the list. */
export function listPeople(db: Db | Tx): Person[] {
  return db.select({ id: users.id, role: users.role, active: users.active }).from(users).all()
}

/** One row of the admin's people list: never the password hash. */
export interface PersonSummary {
  id: number
  username: string
  displayName: string
  role: Person['role']
  active: boolean
}

/** Everyone, for the admin console's people list (#47). Selects named columns only. */
export function listUsers(db: Db | Tx): PersonSummary[] {
  return db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      active: users.active,
    })
    .from(users)
    .orderBy(asc(users.id))
    .all()
}

/**
 * Runs whenever people change (added, deactivated, reactivated, role changed), inside the same
 * transaction as the change, with everyone as they are after it. Each hook writes its own audit
 * entries through `tx`, stamped with `now`, the change's own time. The hooks themselves are
 * listed in `./hooks`.
 */
export type PeopleChangeHook = (tx: Tx, people: Person[], now: Date) => void

export function runPeopleChangeHooks(tx: Tx, hooks: readonly PeopleChangeHook[], now: Date): void {
  if (hooks.length === 0) return
  const people = listPeople(tx)
  for (const hook of hooks) hook(tx, people, now)
}
