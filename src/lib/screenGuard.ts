import { redirect } from '@tanstack/react-router'
import type { Role } from '~/domain/parties'
import { landingPath } from './landing'
import { canSee, type AppPath } from './nav'

/**
 * For a screen's `beforeLoad`: a role that may not see `path` goes to its own landing page.
 * Navigation only; server functions check roles again (src/server/auth/guards).
 */
export function guardScreen(role: Role, path: AppPath): void {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect
  if (!canSee(role, path)) throw redirect({ to: landingPath(role) })
}
