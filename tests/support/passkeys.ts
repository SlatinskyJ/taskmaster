import { auditLog } from '~/server/db/schema'
import type { CurrentUser } from '~/server/auth'
import type { Db } from '~/server/db'
import { createTestDb } from '~/server/db/testing'
import type { PasskeyConfig } from '~/server/passkeys/config'
import { createUser } from '~/server/users'
import { SoftAuthenticator } from './softAuthenticator'

// Shared fixture for the passkey tests: a family, a relying party, and a phone per person.

export const CONFIG: PasskeyConfig = {
  rpId: 'tm.test',
  rpName: 'Taskmaster',
  origin: 'https://tm.test',
}
export const T0 = new Date('2026-11-18T10:00:00.000Z')
export const at = (ms: number) => new Date(T0.getTime() + ms)
export const IP = '203.0.113.7'
export const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'

export function must<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

export interface Family {
  db: Db
  admin: CurrentUser
  tata: CurrentUser
  starsi: CurrentUser
}

export function family(): Family {
  const db = createTestDb()
  const make = (username: string, displayName: string, role: CurrentUser['role']) => {
    const u = must(createUser(db, { kind: 'system' }, { username, displayName, role }, T0))
    return { id: u.id, username: u.username, displayName: u.displayName, role: u.role }
  }
  return {
    db,
    admin: make('admin', 'Správce', 'admin'),
    tata: make('tata', 'Táta', 'giver'),
    starsi: make('starsi', 'Starší', 'taker'),
  }
}

export const phone = () => new SoftAuthenticator({ rpId: CONFIG.rpId, origin: CONFIG.origin })

export const audit = (db: Db) => db.select().from(auditLog).all()
export const auditOf = (db: Db, action: string) => audit(db).filter((a) => a.action === action)

/** Makes `db`'s audit log refuse entries of one action, to prove a change rolls back. */
export function breakAudit(db: Db, action: string): void {
  db.$client.exec(
    `CREATE TRIGGER fail_${action.replace('.', '_')} BEFORE INSERT ON audit_log
     WHEN NEW.action = '${action}' BEGIN SELECT RAISE(ABORT, 'audit down'); END`,
  )
}
