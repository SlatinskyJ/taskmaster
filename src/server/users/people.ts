import type { Person } from '~/domain'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { users } from '~/server/db/schema'

/** Everyone, as the domain sees them (spec §3). Inactive people stay in the list. */
export function listPeople(db: Db | Tx): Person[] {
  return db.select({ id: users.id, role: users.role, active: users.active }).from(users).all()
}

/**
 * Runs whenever people change (added, deactivated, reactivated, role changed), inside the same
 * transaction as the change, with everyone as they are after it. Each hook writes its own audit
 * entries through `tx`. The hooks themselves are listed in `./hooks`.
 */
export type PeopleChangeHook = (tx: Tx, people: Person[]) => void

export function runPeopleChangeHooks(tx: Tx, hooks: readonly PeopleChangeHook[]): void {
  if (hooks.length === 0) return
  const people = listPeople(tx)
  for (const hook of hooks) hook(tx, people)
}
