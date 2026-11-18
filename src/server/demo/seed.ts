import { hashSync } from '@node-rs/argon2'
import type { Db } from '~/server/db'
import { users } from '~/server/db/schema'
import { createUser } from '~/server/users'
import type { NewUser } from '~/server/users'

// Demo data for previews, dev and E2E (#62): an empty database gets the family with known
// passwords, so a preview is clickable right away. This is the only source of test users
// (Jakub 2026-11-17); production gets its one admin from ADMIN_PASSWORD (../users/bootstrap). Runs at boot (src/server/plugins) only when
// `TASKMASTER_ENV=preview`; to try it locally: `TASKMASTER_ENV=preview pnpm dev` on a fresh
// `DATA_DIR`.
//
// Guards: never without the preview flag, never when ADMIN_PASSWORD is set (a real deploy
// sets it), and never on a database that already has people (a real family's database always
// does). All tested.
//
// Grows with features: each feature PR adds its sample data here (tasks in every state, a
// template, an open period, a past settlement), in the same transaction.

/** Known on purpose: previews are tailnet-only and hold no real data. Never used in production. */
export const DEMO_PASSWORD = 'demo1234'

export const DEMO_USERS: readonly NewUser[] = [
  { username: 'admin', displayName: 'Admin', role: 'admin' },
  { username: 'tata', displayName: 'Táta', role: 'giver' },
  { username: 'starsi', displayName: 'Starší', role: 'taker' },
  { username: 'mladsi', displayName: 'Mladší', role: 'taker' },
]

export type DemoOutcome =
  | { kind: 'seeded'; usernames: string[] }
  | { kind: 'skipped'; reason: 'not_preview' | 'admin_password_set' | 'not_empty' }

export function seedDemo(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): DemoOutcome {
  if (env.TASKMASTER_ENV !== 'preview') return { kind: 'skipped', reason: 'not_preview' }
  // A real deploy sets ADMIN_PASSWORD. If the preview flag ever leaks into one, the known
  // demo password must still never create an account.
  if ((env.ADMIN_PASSWORD ?? '') !== '') return { kind: 'skipped', reason: 'admin_password_set' }
  if (db.select({ id: users.id }).from(users).limit(1).get()) {
    return { kind: 'skipped', reason: 'not_empty' }
  }
  const passwordHash = hashSync(DEMO_PASSWORD)
  return db.transaction((tx) => {
    // Re-checked inside the transaction, so two boots can't both seed.
    if (tx.select({ id: users.id }).from(users).limit(1).get()) {
      return { kind: 'skipped', reason: 'not_empty' } as const
    }
    for (const person of DEMO_USERS) {
      const created = createUser(tx, { kind: 'system' }, { ...person, passwordHash }, now)
      if (!created.ok)
        throw new Error(`Demo seed: cannot create "${person.username}": ${created.error}`)
    }
    return { kind: 'seeded', usernames: DEMO_USERS.map((u) => u.username) } as const
  })
}

export function describeDemo(outcome: DemoOutcome): string | null {
  if (outcome.kind === 'skipped') {
    if (outcome.reason === 'not_empty') return '[demo] database has people already: not seeding'
    if (outcome.reason === 'admin_password_set') return '[demo] ADMIN_PASSWORD is set: not seeding'
    return null
  }
  return `[demo] seeded ${outcome.usernames.join(', ')} (password "${DEMO_PASSWORD}")`
}
