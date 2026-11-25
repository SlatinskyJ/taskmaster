import { findSession } from '~/server/auth/sessions'
import type { Db } from '~/server/db'
import { getFlags } from '~/server/features'
import { addPerson, editPerson, resetPassword } from './admin'
import type { AddPersonInput, PeopleError } from './admin'
import { changeOwnPassword } from './changePassword'
import type { ChangePasswordError } from './changePassword'
import type { ChangePasswordData, PersonEdit } from './parse'
import type { PersonSummary } from './people'

// What each people server function does with its parsed input, so it is tested without the
// framework (./functions passes `getDb()` and the signed-in admin's id, nothing else; for
// `changePasswordAction` the signed-in user's id, their session cookie and the client IP).

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

export type ChangePasswordResult =
  { ok: true; othersLoggedOut: number } | { ok: false; error: ChangePasswordError | 'feature_off' }

/**
 * Profil → Změnit heslo (#210), behind the `passwordChange` switch: with it off nothing is
 * checked or written. `sessionToken` is the request's cookie; it must belong to `userId`.
 */
export async function changePasswordAction(
  db: Db,
  userId: number,
  sessionToken: string,
  data: ChangePasswordData,
  ip: string,
  now?: Date,
): Promise<ChangePasswordResult> {
  if (!getFlags(db).passwordChange) return { ok: false, error: 'feature_off' }
  const session = findSession(db, sessionToken)
  if (session?.userId !== userId) throw new Error('Unauthorized')
  const r = await changeOwnPassword(
    db,
    {
      userId,
      sessionId: session.id,
      current: data.current,
      next: data.next,
      logOutOthers: data.logOutOthers,
      ip,
    },
    now,
  )
  return r.ok ? { ok: true, othersLoggedOut: r.value.sessionsEnded } : r
}
