import { createServerFn } from '@tanstack/react-start'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import { createUserAction, resetPasswordAction, updateUserAction } from './actions'
import type { PeopleActionResult, ResetPasswordResult } from './actions'
import type { PeopleError } from './admin'
import { parseNewPerson, parsePersonEdit, parseReset } from './parse'
import { listUsers } from './people'
import type { PersonSummary } from './people'

// Server functions for the admin console (#47, #134). Admin only; ./manage checks it again
// inside each write's transaction. Each handler is one call into ./actions (tested there).

export type { PeopleActionResult, PeopleError, PersonSummary, ResetPasswordResult }

/** Everyone, for the people list on Správa. Never the password hash (see `listUsers`). */
export const listUsersFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('admin')])
  .handler(() => listUsers(getDb()))

/** Adds a person with a starting password the admin passes on. */
export const createUserFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin')])
  .validator(parseNewPerson)
  .handler(({ data, context }) => createUserAction(getDb(), context.user.id, data))

/** Renames and/or changes the role of `data.userId`. */
export const updateUserFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin')])
  .validator(parsePersonEdit)
  .handler(({ data, context }) => updateUserAction(getDb(), context.user.id, data))

/** Sets a new password for `data.userId`; their sessions end. */
export const resetPasswordFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin')])
  .validator(parseReset)
  .handler(({ data, context }) => resetPasswordAction(getDb(), context.user.id, data))
