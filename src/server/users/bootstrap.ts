import { hashSync } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import type { Db } from '~/server/db'
import { users } from '~/server/db/schema'
import { createUser } from './manage'
import type { NewUser } from './manage'

// First admin (spec §6, Jakub 2026-11-17): on a database with no admin, boot creates one from
// `ADMIN_PASSWORD` (login `ADMIN_USERNAME`, default "admin"). After that the variable does
// nothing but earn a warning, so the admin removes it; everyone else is added in the admin
// console. The password is never logged.
//
// `TEST_USERS=1` (dev and previews only, Jakub 2026-11-17) also creates Táta, Starší and
// Mladší with the same password, in the same step. Ignored in production unless
// `TASKMASTER_ENV=preview`. Fuller demo data is #62.

export const MIN_ADMIN_PASSWORD = 12

export const TEST_USERS: readonly NewUser[] = [
  { username: 'tata', displayName: 'Táta', role: 'giver' },
  { username: 'starsi', displayName: 'Starší', role: 'taker' },
  { username: 'mladsi', displayName: 'Mladší', role: 'taker' },
]

export type BootstrapOutcome =
  | { kind: 'created'; username: string; testUsers: string[] }
  /** No admin yet and no `ADMIN_PASSWORD`: nobody can manage people until it is set. */
  | { kind: 'no_admin' }
  /** An admin exists and `ADMIN_PASSWORD` is still set: remove it. */
  | { kind: 'remove_env' }
  | { kind: 'nothing' }

// Sync on purpose: boot plugins are not awaited, so a throw here must stop boot synchronously.
export function bootstrapAdmin(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): BootstrapOutcome {
  const password = env.ADMIN_PASSWORD ?? ''
  const hasAdmin = db.select().from(users).where(eq(users.role, 'admin')).get() !== undefined
  if (hasAdmin) return password === '' ? { kind: 'nothing' } : { kind: 'remove_env' }
  if (password === '') return { kind: 'no_admin' }
  if (password.length < MIN_ADMIN_PASSWORD) {
    throw new Error(`ADMIN_PASSWORD must be at least ${String(MIN_ADMIN_PASSWORD)} characters`)
  }
  const username = env.ADMIN_USERNAME ?? 'admin'
  const passwordHash = hashSync(password)
  const withTestUsers = testUsersAllowed(env)
  // One transaction: a failure leaves no half-made family behind.
  return db.transaction((tx) => {
    const people: NewUser[] = [
      { username, displayName: 'Admin', role: 'admin', passwordHash },
      ...(withTestUsers ? TEST_USERS.map((u) => ({ ...u, passwordHash })) : []),
    ]
    for (const person of people) {
      const created = createUser(tx, { kind: 'system' }, person, now)
      if (!created.ok) throw new Error(`Cannot create user "${person.username}": ${created.error}`)
    }
    return {
      kind: 'created',
      username,
      testUsers: withTestUsers ? TEST_USERS.map((u) => u.username) : [],
    }
  })
}

function testUsersAllowed(env: NodeJS.ProcessEnv): boolean {
  if (env.TEST_USERS !== '1') return false
  return env.NODE_ENV !== 'production' || env.TASKMASTER_ENV === 'preview'
}

export function describeBootstrap(outcome: BootstrapOutcome): string | null {
  switch (outcome.kind) {
    case 'created':
      return outcome.testUsers.length > 0
        ? `[users] admin "${outcome.username}" and test users ${outcome.testUsers.join(', ')} created; remove ADMIN_PASSWORD now`
        : `[users] first admin "${outcome.username}" created from ADMIN_PASSWORD; remove the variable now`
    case 'no_admin':
      return '[users] no admin yet: set ADMIN_PASSWORD and restart to create one'
    case 'remove_env':
      return '[users] ADMIN_PASSWORD is still set but an admin exists; remove it'
    case 'nothing':
      return null
  }
}
