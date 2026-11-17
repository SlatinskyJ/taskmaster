import { USER_ROLES } from '~/server/db/schema'
import type { UserRole } from '~/server/db/schema'

// The family config: the one place the admin adds, changes or deactivates people (spec §6:
// "adding Mum = a config change"). A JSON file on the data volume, never committed; the repo
// ships `config/family.example.json`. Read and applied at every boot (`seedUsers`).
//
// {
//   "users": [
//     { "username": "tata", "displayName": "Táta", "role": "giver" },
//     { "username": "jakub", "displayName": "Jakub", "role": "admin", "passwordHash": "$argon2id$…" },
//     { "username": "mama", "displayName": "Máma", "role": "giver", "active": false }
//   ]
// }
//
// - `username` matches the row; renaming one creates a new person, so don't.
// - `active` defaults to true. People missing from the file are left as they are (never deleted).
// - `passwordHash` is optional: an argon2id PHC string, never a plain password. When given, it
//   replaces the stored hash. Password tooling arrives with login (#27).

export interface FamilyUser {
  username: string
  displayName: string
  role: UserRole
  active: boolean
  passwordHash: string | null
}

export interface FamilyConfig {
  users: FamilyUser[]
}

const USERNAME = /^[a-z][a-z0-9._-]{1,31}$/
const MAX_NAME = 40

/** Parses and validates the config. Throws with every problem listed; never echoes hashes. */
export function parseFamilyConfig(json: string): FamilyConfig {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('Family config: not valid JSON')
  }
  const problems: string[] = []
  const list = isObject(raw) ? raw.users : undefined
  if (!Array.isArray(list)) throw new Error('Family config: expected { "users": [...] }')

  const users: FamilyUser[] = []
  const seen = new Set<string>()
  list.forEach((entry: unknown, i) => {
    const at = `users[${String(i)}]`
    if (!isObject(entry)) {
      problems.push(`${at}: not an object`)
      return
    }
    const { username, displayName, role, active, passwordHash } = entry
    for (const key of Object.keys(entry)) {
      if (!['username', 'displayName', 'role', 'active', 'passwordHash'].includes(key)) {
        // Catches a plain "password" by mistake, among others.
        problems.push(`${at}: unknown field "${key}"`)
      }
    }
    if (typeof username !== 'string' || !USERNAME.test(username)) {
      problems.push(`${at}: username must be 2–32 chars, lowercase a–z, 0–9, . _ -`)
    } else if (seen.has(username)) {
      problems.push(`${at}: duplicate username "${username}"`)
    } else {
      seen.add(username)
    }
    const name = typeof displayName === 'string' ? displayName.trim() : ''
    if (name === '' || name.length > MAX_NAME) {
      problems.push(`${at}: displayName must be 1–${String(MAX_NAME)} characters`)
    }
    if (typeof role !== 'string' || !(USER_ROLES as readonly string[]).includes(role)) {
      problems.push(`${at}: role must be one of ${USER_ROLES.join(', ')}`)
    }
    if (active !== undefined && typeof active !== 'boolean') {
      problems.push(`${at}: active must be true or false`)
    }
    if (
      passwordHash !== undefined &&
      (typeof passwordHash !== 'string' || !passwordHash.startsWith('$argon2id$'))
    ) {
      problems.push(`${at}: passwordHash must be an argon2id hash ($argon2id$…)`)
    }
    users.push({
      username: String(username),
      displayName: name,
      role: role as UserRole,
      active: active !== false,
      passwordHash: typeof passwordHash === 'string' ? passwordHash : null,
    })
  })
  if (problems.length > 0) throw new Error(`Family config:\n  ${problems.join('\n  ')}`)
  return { users }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
