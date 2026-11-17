import { hashSync } from '@node-rs/argon2'
import type { Db } from '~/server/db'
import { users } from '~/server/db/schema'
import { createUser, TEST_USERS } from '~/server/users'
import type { NewUser } from '~/server/users'

// Demo data for previews, dev and E2E (#62): an empty database gets the family with known
// passwords, so a preview is clickable right away. Runs at boot (src/server/plugins) only when
// `TASKMASTER_ENV=preview`; to try it locally: `TASKMASTER_ENV=preview pnpm dev` on a fresh
// `DATA_DIR`.
//
// Guards: never without the preview flag, and never on a database that already has people
// (a real family's database always does). Both are tested.
//
// Grows with features: each feature PR adds its sample data here (tasks in every state, a
// template, an open period, a past settlement), in the same transaction.

/** Known on purpose: previews are tailnet-only and hold no real data. Never used in production. */
export const DEMO_PASSWORD = 'demo1234'

export const DEMO_USERS: readonly NewUser[] = [
  { username: 'admin', displayName: 'Admin', role: 'admin' },
  ...TEST_USERS,
]

export type DemoOutcome =
  { kind: 'seeded'; usernames: string[] } | { kind: 'skipped'; reason: 'not_preview' | 'not_empty' }

export function seedDemo(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): DemoOutcome {
  if (env.TASKMASTER_ENV !== 'preview') return { kind: 'skipped', reason: 'not_preview' }
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
    return outcome.reason === 'not_empty' ? '[demo] database has people already: not seeding' : null
  }
  return `[demo] seeded ${outcome.usernames.join(', ')} (password "${DEMO_PASSWORD}")`
}
