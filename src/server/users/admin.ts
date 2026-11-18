import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { MAX_PASSWORD_LENGTH, MIN_USER_PASSWORD } from '~/lib/userLimits'
import { hashPassword } from '~/server/auth/password'
import type { Actor } from '~/server/audit'
import type { Db } from '~/server/db'
import type { UserRole, UserRow } from '~/server/db/schema'
import { createUser, setPasswordHash, updateUser } from './manage'
import type { UserError } from './manage'
import type { PersonSummary } from './people'

// The admin console's people actions (spec §6, #134): checks and hashes the password, then
// calls ./manage, which checks the actor is an active admin and writes the row and its audit
// entry in one transaction. Nothing here writes to the DB itself. Results are `PersonSummary`
// (or just the id), never the row with its hash.

export { MIN_USER_PASSWORD }

export type PeopleError = UserError | 'invalid_password'

export interface AddPersonInput {
  username: string
  displayName: string
  role: UserRole
  password: string
}

export interface EditPersonInput {
  displayName?: string
  role?: UserRole
}

const validPassword = (password: string): boolean =>
  password.length >= MIN_USER_PASSWORD && password.length <= MAX_PASSWORD_LENGTH

const asAdmin = (adminId: number): Actor => ({ kind: 'user', userId: adminId })

function summary(u: UserRow): PersonSummary {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    active: u.active,
  }
}

/** Adds a person. The login name is trimmed and lower-cased, as login does. */
export async function addPerson(
  db: Db,
  adminId: number,
  input: AddPersonInput,
  now: Date = new Date(),
): Promise<Result<PersonSummary, PeopleError>> {
  if (!validPassword(input.password)) return fail('invalid_password')
  const passwordHash = await hashPassword(input.password)
  const created = createUser(
    db,
    asAdmin(adminId),
    {
      username: input.username.trim().toLowerCase(),
      displayName: input.displayName,
      role: input.role,
      passwordHash,
    },
    now,
  )
  return created.ok ? ok(summary(created.value)) : created
}

/** Renames and/or changes the role. Never touches `active` (Jakub: no deactivation UI). */
export function editPerson(
  db: Db,
  adminId: number,
  userId: number,
  input: EditPersonInput,
  now: Date = new Date(),
): Result<PersonSummary, PeopleError> {
  const changes: EditPersonInput = {}
  if (input.displayName !== undefined) changes.displayName = input.displayName
  if (input.role !== undefined) changes.role = input.role
  const updated = updateUser(db, asAdmin(adminId), userId, changes, now)
  return updated.ok ? ok(summary(updated.value)) : updated
}

/** Sets a new password the admin chose; the person's sessions end (spec §6). */
export async function resetPassword(
  db: Db,
  adminId: number,
  userId: number,
  password: string,
  now: Date = new Date(),
): Promise<Result<{ id: number }, PeopleError>> {
  if (!validPassword(password)) return fail('invalid_password')
  const passwordHash = await hashPassword(password)
  const updated = setPasswordHash(db, asAdmin(adminId), userId, passwordHash, now)
  return updated.ok ? ok({ id: updated.value.id }) : updated
}
