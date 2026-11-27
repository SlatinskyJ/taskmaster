import { createServerFn } from '@tanstack/react-start'
import { requireRole, requireUser } from '~/server/auth/guards'
import { clientIp, sessionToken } from '~/server/auth/http'
import { getDb } from '~/server/db'
import { demoLock } from '~/server/demo/lock'
import { liveRead } from '~/server/live/define'
import { serveLive } from '~/server/live/read'
import {
  changePasswordAction,
  createUserAction,
  resetPasswordAction,
  updateUserAction,
} from './actions'
import type { ChangePasswordResult, PeopleActionResult, ResetPasswordResult } from './actions'
import type { PeopleError } from './admin'
import { parseChangePassword, parseNewPerson, parsePersonEdit, parseReset } from './parse'
import { listUsers } from './people'
import type { PersonSummary } from './people'

// Server functions for the admin console (#47, #134). Admin only, except `changePasswordFn`
// (any signed-in user, own account, #210); ./manage checks the admin again inside each write's
// transaction. Each handler is one call into ./actions (tested there).

export type {
  ChangePasswordResult,
  PeopleActionResult,
  PeopleError,
  PersonSummary,
  ResetPasswordResult,
}

/** Everyone, for the people list on Správa. Never the password hash (see `listUsers`). */
export const usersRead = liveRead({
  read: (db) => listUsers(db),
  topics: () => ['people'] as const,
})

export const listUsersFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('admin')])
  .handler(({ context }) => serveLive(usersRead, context.user, undefined))

/** Adds a person with a starting password the admin passes on. */
export const createUserFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin'), demoLock])
  .validator(parseNewPerson)
  .handler(({ data, context }) => createUserAction(getDb(), context.user.id, data))

/** Renames and/or changes the role of `data.userId`. */
export const updateUserFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin'), demoLock])
  .validator(parsePersonEdit)
  .handler(({ data, context }) => updateUserAction(getDb(), context.user.id, data))

/** Sets a new password for `data.userId`; their sessions end. */
export const resetPasswordFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin'), demoLock])
  .validator(parseReset)
  .handler(({ data, context }) => resetPasswordAction(getDb(), context.user.id, data))

/** Profil → Změnit heslo (#210): the signed-in user's own password. */
export const changePasswordFn = createServerFn({ method: 'POST' })
  .middleware([requireUser, demoLock])
  .validator(parseChangePassword)
  .handler(({ data, context }) =>
    changePasswordAction(getDb(), context.user.id, sessionToken() ?? '', data, clientIp()),
  )
