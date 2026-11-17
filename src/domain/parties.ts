// Who counts as "all parties" (spec §3).

export type PersonId = number
export const ROLES = ['taker', 'giver', 'admin'] as const
export type Role = (typeof ROLES)[number]

export interface Person {
  id: PersonId
  role: Role
  /** Inactive people keep their history but take no part in new agreements. */
  active: boolean
}

/** A party to agreements: an active giver or taker. The admin never is (spec §3). */
export function isParty(person: Person): boolean {
  return person.active && (person.role === 'giver' || person.role === 'taker')
}

export function isActiveTaker(person: Person): boolean {
  return person.active && person.role === 'taker'
}

export function isActiveGiver(person: Person): boolean {
  return person.active && person.role === 'giver'
}

/**
 * "All parties" = all active givers + all active takers, evaluated now (spec §3). When Mum is
 * added as a giver she is in the set from that moment on, with no code change.
 */
export function allParties(people: readonly Person[]): PersonId[] {
  return people
    .filter(isParty)
    .map((p) => p.id)
    .sort((a, b) => a - b)
}

export function findPerson(people: readonly Person[], id: PersonId): Person | undefined {
  return people.find((p) => p.id === id)
}

/** The admin, while active. Never a party (spec §3). */
export function isActiveAdmin(person: Person): boolean {
  return person.active && person.role === 'admin'
}
