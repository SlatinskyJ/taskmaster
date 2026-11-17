import { eq } from 'drizzle-orm'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Tx } from '~/server/audit'
import { toIsoUtc } from '~/domain/dates'
import { writeAudit } from '~/server/audit'
import type { Db } from '~/server/db'
import { users } from '~/server/db/schema'
import type { UserRow } from '~/server/db/schema'
import type { FamilyConfig, FamilyUser } from './config'
import { parseFamilyConfig } from './config'
import { PEOPLE_CHANGE_HOOKS } from './hooks'
import type { PeopleChangeHook } from './people'
import { runPeopleChangeHooks } from './people'

/** Where the family config lives: `$FAMILY_CONFIG`, else `$DATA_DIR/family.json`. */
export function familyConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.FAMILY_CONFIG ?? join(env.DATA_DIR ?? '.data', 'family.json'))
}

export interface SeedResult {
  created: string[]
  updated: string[]
}

/** What the audit log may see of a user: everything but the hash, plus whether one is set. */
function auditView(
  u: Pick<UserRow, 'username' | 'displayName' | 'role' | 'active' | 'passwordHash'>,
) {
  return {
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    active: u.active,
    // Not "hasPassword": keys with "password" are redacted by the audit module.
    hashSet: u.passwordHash !== null,
  }
}

function differs(row: UserRow, want: FamilyUser): boolean {
  return (
    row.displayName !== want.displayName ||
    row.role !== want.role ||
    row.active !== want.active ||
    (want.passwordHash !== null && row.passwordHash !== want.passwordHash)
  )
}

/**
 * Applies the family config: creates missing people, updates changed ones, leaves the rest.
 * Idempotent: a second run with the same config changes nothing and writes no audit entry.
 * All in one transaction with an audit entry per change (actor: system, reason "family
 * config"); then, if anyone changed, the people-change hooks (default: `PEOPLE_CHANGE_HOOKS`)
 * run in the same transaction.
 */
export function seedUsers(
  db: Db,
  config: FamilyConfig,
  now: Date = new Date(),
  hooks: readonly PeopleChangeHook[] = PEOPLE_CHANGE_HOOKS,
): SeedResult {
  const at = toIsoUtc(now)
  return db.transaction((tx) => {
    const result: SeedResult = { created: [], updated: [] }
    for (const want of config.users) {
      const row = tx.select().from(users).where(eq(users.username, want.username)).get()
      if (!row) {
        const created = tx
          .insert(users)
          .values({ ...want, createdAt: at, updatedAt: at })
          .returning()
          .get()
        audit(tx, 'user.created', created.id, null, auditView(created), now)
        result.created.push(want.username)
        continue
      }
      if (!differs(row, want)) continue
      const updated = tx
        .update(users)
        .set({
          displayName: want.displayName,
          role: want.role,
          active: want.active,
          passwordHash: want.passwordHash ?? row.passwordHash,
          updatedAt: at,
        })
        .where(eq(users.id, row.id))
        .returning()
        .get()
      const after = auditView(updated)
      // hashSet alone reads true → true on a rotation; say so, or the log can't show it.
      const hashChanged = updated.passwordHash !== row.passwordHash
      audit(
        tx,
        'user.updated',
        row.id,
        auditView(row),
        hashChanged ? { ...after, hashChanged } : after,
        now,
      )
      result.updated.push(want.username)
    }
    if (result.created.length > 0 || result.updated.length > 0) runPeopleChangeHooks(tx, hooks)
    return result
  })
}

function audit(
  tx: Tx,
  action: 'user.created' | 'user.updated',
  id: number,
  before: unknown,
  after: unknown,
  at: Date,
): void {
  writeAudit(tx, {
    actor: { kind: 'system' },
    action,
    entityType: 'user',
    entityId: id,
    before,
    after,
    reason: 'family config',
    at,
  })
}

/**
 * Boot step: reads the family config if the file exists and applies it. A missing file is
 * fine (nothing to seed yet); an invalid one throws, so the server doesn't start on a
 * half-understood family.
 */
export function seedUsersFromFile(db: Db, path: string = familyConfigPath()): SeedResult | null {
  if (!existsSync(path)) return null
  return seedUsers(db, parseFamilyConfig(readFileSync(path, 'utf8')))
}
