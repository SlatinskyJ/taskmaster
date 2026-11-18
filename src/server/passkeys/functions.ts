import { createServerFn } from '@tanstack/react-start'
import { requireRole, requireUser } from '~/server/auth/guards'
import {
  listMyPasskeys,
  listPasskeyCounts,
  passkeyLogin,
  passkeyLoginOptions,
  passkeyRegister,
  passkeyRegisterOptions,
  passkeysEnabled,
  removeAllPasskeysOf,
  removeMyPasskey,
} from './handlers'
import { parseId } from './parse'

export type { OptionsResult, PasskeyLoginResult, PasskeyRegisterResult } from './handlers'
export type { PasskeySummary } from './register'

// Server functions for passkeys (#29). Thin wrappers: guard, validate, call ./handlers.
// The three public ones are listed in PUBLIC_SERVER_FNS (~/server/auth/guards).

/** Whether this deployment offers passkeys (WEBAUTHN_RP_ID set). */
export const getPasskeysEnabledFn = createServerFn({ method: 'GET' }).handler(() =>
  passkeysEnabled(),
)

export const passkeyLoginOptionsFn = createServerFn({ method: 'POST' }).handler(() =>
  passkeyLoginOptions(),
)

export const passkeyLoginFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data)
  .handler(({ data }) => passkeyLogin(data))

export const passkeyRegisterOptionsFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .handler(({ context }) => passkeyRegisterOptions(context.user))

export const passkeyRegisterFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator((data: unknown) => data)
  .handler(({ data, context }) => passkeyRegister(context.user, data))

export const listMyPasskeysFn = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(({ context }) => listMyPasskeys(context.user))

export const removeMyPasskeyFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator((data: unknown) => parseId(data, 'passkeyId'))
  .handler(({ data, context }) => removeMyPasskey(context.user, data))

export const listPasskeyCountsFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('admin')])
  .handler(() => listPasskeyCounts())

export const removeUserPasskeysFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin')])
  .validator((data: unknown) => parseId(data, 'userId'))
  .handler(({ data, context }) => removeAllPasskeysOf(context.user, data))
