import type { Role } from '~/domain/parties'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import type { CurrentUser } from './sessions'

// The one role check (spec §3). Guards (./guards) and tests call it; nothing else decides who
// may call what. Framework-free so the whole role matrix is unit-tested.

export type AuthError =
  /** Nobody signed in, or the session ended. */
  | 'unauthenticated'
  /** Signed in, but the role may not do this. */
  | 'forbidden'

/** `roles` empty = any signed-in user. */
export function authorize(
  user: CurrentUser | null,
  roles: readonly Role[] = [],
): Result<CurrentUser, AuthError> {
  if (!user) return fail('unauthenticated')
  if (roles.length > 0 && !roles.includes(user.role)) return fail('forbidden')
  return ok(user)
}
