import { redirect } from '@tanstack/react-router'
import { createMiddleware, createServerOnlyFn } from '@tanstack/react-start'
import { setResponseStatus } from '@tanstack/react-start/server'
import type { Role } from '~/domain/parties'
import { authorize } from './authorize'
import { currentUser } from './http'
import type { CurrentUser } from './sessions'

// Guards for server functions (spec §3). Every server function either uses one of these
// middlewares or is listed in PUBLIC_SERVER_FNS; tests/server-fn-guards.test.ts enforces it.
//
//   export const listUsersFn = createServerFn({ method: 'GET' })
//     .middleware([requireRole('admin')])
//     .handler(({ context }) => ... context.user ...)

/**
 * Server functions anyone may call, signed in or not, all in ~/server/auth/functions.ts (the
 * guard scan checks the file too). Adding one needs a reason here.
 */
export const PUBLIC_SERVER_FNS = [
  // The login form is the way in.
  'loginFn',
  // Ending a session needs no rights; without a session it does nothing.
  'logoutFn',
  // Route guards ask it who is signed in; it answers null for nobody.
  'getCurrentUserFn',
] as const

/** Thrown (with HTTP 403) when a signed-in user's role may not call a server function. */
export class ForbiddenError extends Error {
  constructor() {
    super('forbidden')
    this.name = 'ForbiddenError'
  }
}

/**
 * The signed-in user, or a redirect to the login screen. Throws 403 for a wrong role.
 * Server-only: the client bundle gets a stub, so the DB code behind it never ships.
 */
export const guardUser = createServerOnlyFn((roles: readonly Role[] = []): CurrentUser => {
  const result = authorize(currentUser(), roles)
  if (result.ok) return result.value
  if (result.error === 'unauthenticated') {
    setResponseStatus(401)
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect
    throw redirect({ to: '/login' })
  }
  setResponseStatus(403)
  throw new ForbiddenError()
})

/** Any signed-in user; `context.user` in the handler. */
export const requireUser = createMiddleware({ type: 'function' }).server(({ next }) =>
  next({ context: { user: guardUser() } }),
)

/** A signed-in user with one of `roles`; `context.user` in the handler. */
export function requireRole(...roles: [Role, ...Role[]]) {
  return createMiddleware({ type: 'function' }).server(({ next }) =>
    next({ context: { user: guardUser(roles) } }),
  )
}
