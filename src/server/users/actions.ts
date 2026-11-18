import type { Db } from '~/server/db'
import { addPerson, editPerson, resetPassword } from './admin'
import type { AddPersonInput, PeopleError } from './admin'
import type { PersonEdit } from './parse'
import type { PersonSummary } from './people'

// What each people server function does with its parsed input, so it is tested without the
// framework (./functions passes `getDb()` and the signed-in admin's id, nothing else).

export type PeopleActionResult =
  { ok: true; person: PersonSummary } | { ok: false; error: PeopleError }

export type ResetPasswordResult = { ok: true } | { ok: false; error: PeopleError }

export async function createUserAction(
  db: Db,
  adminId: number,
  data: AddPersonInput,
  now?: Date,
): Promise<PeopleActionResult> {
  const r = await addPerson(db, adminId, data, now)
  return r.ok ? { ok: true, person: r.value } : r
}

export function updateUserAction(
  db: Db,
  adminId: number,
  data: PersonEdit,
  now?: Date,
): PeopleActionResult {
  const { userId, ...changes } = data
  const r = editPerson(db, adminId, userId, changes, now)
  return r.ok ? { ok: true, person: r.value } : r
}

export async function resetPasswordAction(
  db: Db,
  adminId: number,
  data: { userId: number; password: string },
  now?: Date,
): Promise<ResetPasswordResult> {
  const r = await resetPassword(db, adminId, data.userId, data.password, now)
  return r.ok ? { ok: true } : r
}
