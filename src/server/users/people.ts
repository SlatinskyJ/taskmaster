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
 * transaction as the change. Features with agreements in flight register here (spec §3,
 * agreement duty from #19, #21):
 * - proposals and bids: re-run `resolveTemplate` / `resolveOneTime` (#33, #37);
 * - reservations of a deactivated taker: release them (#35).
 * Each hook writes its own audit entries through `tx`.
 */
export type PeopleChangeHook = (tx: Tx, people: Person[]) => void

const hooks: PeopleChangeHook[] = []

/** Registers a hook. Call once at module load of the feature that owns the data. */
export function onPeopleChange(hook: PeopleChangeHook): () => void {
  hooks.push(hook)
  return () => {
    const i = hooks.indexOf(hook)
    if (i >= 0) hooks.splice(i, 1)
  }
}

export function runPeopleChangeHooks(tx: Tx): void {
  if (hooks.length === 0) return
  const people = listPeople(tx)
  for (const hook of hooks) hook(tx, people)
}
