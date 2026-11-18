import { createServerFn } from '@tanstack/react-start'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import { addPerson, editPerson, resetPassword } from './admin'
import type { PeopleError } from './admin'
import { parseNewPerson, parsePersonEdit, parseReset } from './parse'
import { listUsers } from './people'
import type { PersonSummary } from './people'

// Server functions for the admin console (#47, #134). Admin only; ./manage checks it again
// inside each write's transaction.

export type { PeopleError, PersonSummary }

export type PeopleActionResult =
  { ok: true; person: PersonSummary } | { ok: false; error: PeopleError }

export type ResetPasswordResult = { ok: true } | { ok: false; error: PeopleError }

/** Everyone, for the people list on Správa. Never the password hash (see `listUsers`). */
export const listUsersFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('admin')])
  .handler(() => listUsers(getDb()))

/** Adds a person with a starting password the admin passes on. */
export const createUserFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin')])
  .validator(parseNewPerson)
  .handler(async ({ data, context }): Promise<PeopleActionResult> => {
    const r = await addPerson(getDb(), context.user.id, data)
    return r.ok ? { ok: true, person: r.value } : r
  })

/** Renames and/or changes the role of `data.userId`. */
export const updateUserFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin')])
  .validator(parsePersonEdit)
  .handler(({ data, context }): PeopleActionResult => {
    const { userId, ...changes } = data
    const r = editPerson(getDb(), context.user.id, userId, changes)
    return r.ok ? { ok: true, person: r.value } : r
  })

/** Sets a new password for `data.userId`; their sessions end. */
export const resetPasswordFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin')])
  .validator(parseReset)
  .handler(async ({ data, context }): Promise<ResetPasswordResult> => {
    const r = await resetPassword(getDb(), context.user.id, data.userId, data.password)
    return r.ok ? { ok: true } : r
  })
