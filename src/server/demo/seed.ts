import { hashSync } from '@node-rs/argon2'
import { DEMO_PASSWORD } from '~/lib/demoAccounts'
import type { Db } from '~/server/db'
import { users } from '~/server/db/schema'
import { setSwitchesIn } from '~/server/features'
import { demoDataAllowed } from '~/server/env/demo'
import { createUser } from '~/server/users'
import type { NewUser } from '~/server/users'
import { SEEDS, isSeedName } from './seeds'
import type { SeedName } from './seeds'

// Demo data for previews, dev and E2E (#62): an empty database gets the family with known
// passwords, so a preview is clickable right away. This is the only source of test users
// (Jakub 2026-11-17); production gets its one admin from ADMIN_PASSWORD (../users/bootstrap).
// Runs at boot (src/server/plugins) only when `TASKMASTER_ENV=preview` or `demo` (the public
// demo, src/server/env/demo.ts); to try it locally: `TASKMASTER_ENV=preview pnpm dev` on a
// fresh `DATA_DIR`.
//
// Guards: never without the preview or demo flag, never when ADMIN_PASSWORD is set (a real
// deploy sets it), and never on a database that already has people (a real family's database
// always does). All tested.
//
// What else it holds is picked by `TASKMASTER_SEED` (#183): a named seed (./seeds.ts) is a list
// of pieces (./pieces.ts, one per feature's sample data) and the launch switches it turns on;
// every other switch goes off.
// Unset, previews and dev get `demo`, which has every piece and every switch on, so a preview
// shows features production still hides. Each e2e suite names its own seed in e2e/suites.ts.
// Everything runs in one transaction, through the real actions.

export const DEMO_USERS: readonly NewUser[] = [
  { username: 'admin', displayName: 'Admin', role: 'admin' },
  { username: 'tata', displayName: 'Táta', role: 'giver' },
  { username: 'starsi', displayName: 'Anička', role: 'taker' },
  { username: 'mladsi', displayName: 'Béďa', role: 'taker' },
]

export type DemoOutcome =
  | { kind: 'seeded'; seed: SeedName; usernames: string[] }
  | { kind: 'skipped'; reason: 'not_preview' | 'admin_password_set' | 'not_empty' }

const WEEK_MS = 7 * 24 * 3_600_000

export function seedDemo(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): DemoOutcome {
  const flag = env.TASKMASTER_ENV
  if (flag !== 'preview' && flag !== 'demo') return { kind: 'skipped', reason: 'not_preview' }
  // A real deploy sets ADMIN_PASSWORD. If the preview or demo flag ever leaks into one, the
  // known demo password must still never create an account. Checked before demoDataAllowed
  // (which also says no then), so the boot log names the reason.
  if ((env.ADMIN_PASSWORD ?? '') !== '') return { kind: 'skipped', reason: 'admin_password_set' }
  if (!demoDataAllowed(env)) return { kind: 'skipped', reason: 'not_preview' }
  // Before the empty check, so a misspelt name fails every boot, not only the first: a suite
  // must never run on data it did not ask for.
  // An empty value (a blank CI env line) counts as unset.
  const seed =
    env.TASKMASTER_SEED === undefined || env.TASKMASTER_SEED === '' ? 'demo' : env.TASKMASTER_SEED
  if (!isSeedName(seed)) {
    throw new Error(
      `Demo seed: unknown TASKMASTER_SEED "${seed}" (known: ${Object.keys(SEEDS).join(', ')})`,
    )
  }
  if (db.select({ id: users.id }).from(users).limit(1).get()) {
    return { kind: 'skipped', reason: 'not_empty' }
  }
  const passwordHash = hashSync(DEMO_PASSWORD)
  return db.transaction((tx) => {
    // Re-checked inside the transaction, so two boots can't both seed.
    if (tx.select({ id: users.id }).from(users).limit(1).get()) {
      return { kind: 'skipped', reason: 'not_empty' } as const
    }
    const ids = new Map<string, number>()
    // The family exists from the past week's start, so the audit log reads in time order.
    const start = new Date(now.getTime() - WEEK_MS)
    for (const person of DEMO_USERS) {
      const created = createUser(tx, { kind: 'system' }, { ...person, passwordHash }, start)
      if (!created.ok)
        throw new Error(`Demo seed: cannot create "${person.username}": ${created.error}`)
      ids.set(person.username, created.value.id)
    }
    const id = (username: string) => ids.get(username) ?? 0
    for (const piece of SEEDS[seed].pieces) piece({ tx, id, now, start })
    setSwitchesIn(tx, SEEDS[seed].features, now)
    return { kind: 'seeded', seed, usernames: DEMO_USERS.map((u) => u.username) } as const
  })
}

export function describeDemo(outcome: DemoOutcome): string | null {
  if (outcome.kind === 'skipped') {
    if (outcome.reason === 'not_empty') return '[demo] database has people already: not seeding'
    if (outcome.reason === 'admin_password_set') return '[demo] ADMIN_PASSWORD is set: not seeding'
    return null
  }
  return `[demo] seeded ${outcome.seed}: ${outcome.usernames.join(', ')} (password "${DEMO_PASSWORD}")`
}
