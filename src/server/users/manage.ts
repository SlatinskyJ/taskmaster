import { and, eq, ne } from 'drizzle-orm'
import { toIsoUtc } from '~/domain/dates'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import type { Actor, Tx } from '~/server/audit'
import { writeAudit } from '~/server/audit'
import type { Db } from '~/server/db'
import { USER_ROLES, users } from '~/server/db/schema'
import type { UserRole, UserRow } from '~/server/db/schema'
import { PEOPLE_CHANGE_HOOKS } from './hooks'
import type { PeopleChangeHook } from './people'
import { runPeopleChangeHooks } from './people'

// People live in the database only (spec §6, Jakub 2026-11-17). The admin console (#47) and
// the first-admin bootstrap (./bootstrap) change them through these functions and nothing else: each
// change is one transaction with its audit entry, and the people-change hooks run in it when
// who takes part changes (added, role, active).
//
// Who may call: an active admin (`{ kind: 'user' }`), or the system for the bootstrap.
// Nobody is ever deleted: deactivate instead, so history keeps pointing at a real row.

export type UserError =
  | 'not_admin'
  | 'not_found'
  | 'invalid_username'
  | 'username_taken'
  | 'invalid_name'
  | 'invalid_role'
  | 'invalid_hash'
  /** The change would leave no active admin, and nobody could manage people any more. */
  | 'last_admin'

export interface NewUser {
  username: string
  displayName: string
  role: UserRole
  /** argon2id PHC string; the caller hashes (see ./bootstrap). */
  passwordHash?: string | null
}

export interface UserChanges {
  displayName?: string
  role?: UserRole
  active?: boolean
}

const USERNAME = /^[a-z][a-z0-9._-]{1,31}$/
export const MAX_DISPLAY_NAME = 40

export function createUser(
  db: Db | Tx,
  by: Actor,
  input: NewUser,
  now: Date = new Date(),
  hooks: readonly PeopleChangeHook[] = PEOPLE_CHANGE_HOOKS,
): Result<UserRow, UserError> {
  const name = input.displayName.trim()
  if (!USERNAME.test(input.username)) return fail('invalid_username')
  if (!validName(name)) return fail('invalid_name')
  if (!validRole(input.role)) return fail('invalid_role')
  const hash = input.passwordHash ?? null
  if (hash !== null && !validHash(hash)) return fail('invalid_hash')
  const at = toIsoUtc(now)
  return db.transaction((tx) => {
    if (!mayManage(tx, by)) return fail('not_admin')
    if (tx.select().from(users).where(eq(users.username, input.username)).get()) {
      return fail('username_taken')
    }
    const row = tx
      .insert(users)
      .values({
        username: input.username,
        displayName: name,
        role: input.role,
        passwordHash: hash,
        createdAt: at,
        updatedAt: at,
      })
      .returning()
      .get()
    audit(tx, by, 'user.created', row.id, null, auditView(row), now)
    runPeopleChangeHooks(tx, hooks)
    return ok(row)
  })
}

/** Renames, changes the role, deactivates or reactivates. Unchanged fields write nothing. */
export function updateUser(
  db: Db | Tx,
  by: Actor,
  userId: number,
  changes: UserChanges,
  now: Date = new Date(),
  hooks: readonly PeopleChangeHook[] = PEOPLE_CHANGE_HOOKS,
): Result<UserRow, UserError> {
  const name = changes.displayName?.trim()
  if (name !== undefined && !validName(name)) return fail('invalid_name')
  if (changes.role !== undefined && !validRole(changes.role)) return fail('invalid_role')
  return db.transaction((tx) => {
    if (!mayManage(tx, by)) return fail('not_admin')
    const row = tx.select().from(users).where(eq(users.id, userId)).get()
    if (!row) return fail('not_found')
    const next = {
      displayName: name ?? row.displayName,
      role: changes.role ?? row.role,
      active: changes.active ?? row.active,
    }
    const takesPartChanged = next.role !== row.role || next.active !== row.active
    if (!takesPartChanged && next.displayName === row.displayName) return ok(row)
    const stopsBeingAdmin =
      row.role === 'admin' && row.active && (next.role !== 'admin' || !next.active)
    if (stopsBeingAdmin && !otherActiveAdmin(tx, row.id)) return fail('last_admin')
    const updated = tx
      .update(users)
      .set({ ...next, updatedAt: toIsoUtc(now) })
      .where(eq(users.id, row.id))
      .returning()
      .get()
    audit(tx, by, 'user.updated', row.id, auditView(row), auditView(updated), now)
    if (takesPartChanged) runPeopleChangeHooks(tx, hooks)
    return ok(updated)
  })
}

/**
 * Sets a new password hash (an admin reset). Ending the user's sessions on
 * a reset (spec §6) is #27's job: sessions don't exist yet.
 */
export function setPasswordHash(
  db: Db | Tx,
  by: Actor,
  userId: number,
  passwordHash: string,
  now: Date = new Date(),
): Result<UserRow, UserError> {
  if (!validHash(passwordHash)) return fail('invalid_hash')
  return db.transaction((tx) => {
    if (!mayManage(tx, by)) return fail('not_admin')
    const row = tx.select().from(users).where(eq(users.id, userId)).get()
    if (!row) return fail('not_found')
    const updated = tx
      .update(users)
      .set({ passwordHash, updatedAt: toIsoUtc(now) })
      .where(eq(users.id, row.id))
      .returning()
      .get()
    // hashSet alone reads true → true on a reset; say so, or the log can't show it.
    // Not "passwordReset": keys with "password" are redacted by the audit module.
    const after = { ...auditView(updated), hashChanged: true }
    audit(tx, by, 'user.updated', row.id, auditView(row), after, now)
    return ok(updated)
  })
}

function mayManage(tx: Tx, by: Actor): boolean {
  if (by.kind === 'system') return true
  if (by.kind !== 'user') return false
  const actor = tx.select().from(users).where(eq(users.id, by.userId)).get()
  return actor?.role === 'admin' && actor.active
}

function otherActiveAdmin(tx: Tx, userId: number): boolean {
  return (
    tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, userId)))
      .get() !== undefined
  )
}

const validName = (name: string): boolean => name !== '' && name.length <= MAX_DISPLAY_NAME
const validRole = (role: string): boolean => (USER_ROLES as readonly string[]).includes(role)
const validHash = (hash: string): boolean => hash.startsWith('$argon2id$')

/** What the audit log may see of a user: everything but the hash, plus whether one is set. */
function auditView(u: UserRow) {
  return {
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    active: u.active,
    // Not "hasPassword": keys with "password" are redacted by the audit module.
    hashSet: u.passwordHash !== null,
  }
}

function audit(
  tx: Tx,
  actor: Actor,
  action: 'user.created' | 'user.updated',
  id: number,
  before: unknown,
  after: unknown,
  at: Date,
): void {
  writeAudit(tx, { actor, action, entityType: 'user', entityId: id, before, after, at })
}
