import { hashSync } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import type { Db } from '~/server/db'
import { users } from '~/server/db/schema'
import { createUser } from './manage'
import type { NewUser } from './manage'

// First admin (spec §6, Jakub 2026-11-17): on a database with no admin, boot creates one from
// `ADMIN_PASSWORD` (login `ADMIN_USERNAME`, default "admin"). Once an admin exists the
// variable is ignored, so it may stay set (a deploy secret reused for every fresh preview DB);
// it never changes an existing password. Everyone else is added in the admin console. The
// password is never logged. Dev and previews get their test family from the demo seed
// (src/server/demo) instead, which runs first and fills an empty DB.

export const MIN_ADMIN_PASSWORD = 12

export type BootstrapOutcome =
  | { kind: 'created'; username: string }
  /** No admin yet and no `ADMIN_PASSWORD`: nobody can manage people until it is set. */
  | { kind: 'no_admin' }
  | { kind: 'nothing' }

// Sync on purpose: boot plugins are not awaited, so a throw here must stop boot synchronously.
export function bootstrapAdmin(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): BootstrapOutcome {
  const password = env.ADMIN_PASSWORD ?? ''
  const hasAdmin = db.select().from(users).where(eq(users.role, 'admin')).get() !== undefined
  if (hasAdmin) return { kind: 'nothing' }
  if (password === '') return { kind: 'no_admin' }
  if (password.length < MIN_ADMIN_PASSWORD) {
    throw new Error(`ADMIN_PASSWORD must be at least ${String(MIN_ADMIN_PASSWORD)} characters`)
  }
  const username = env.ADMIN_USERNAME ?? 'admin'
  const passwordHash = hashSync(password)
  const admin: NewUser = { username, displayName: 'Admin', role: 'admin', passwordHash }
  // One transaction: the user row and its audit entry land together or not at all.
  return db.transaction((tx) => {
    const created = createUser(tx, { kind: 'system' }, admin, now)
    if (!created.ok) throw new Error(`Cannot create user "${username}": ${created.error}`)
    return { kind: 'created', username }
  })
}

export function describeBootstrap(outcome: BootstrapOutcome): string | null {
  switch (outcome.kind) {
    case 'created':
      return `[users] first admin "${outcome.username}" created from ADMIN_PASSWORD`
    case 'no_admin':
      return '[users] no admin yet: set ADMIN_PASSWORD and restart to create one'
    case 'nothing':
      return null
  }
}
