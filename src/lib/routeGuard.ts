import { redirect } from '@tanstack/react-router'
import type { Role } from '~/domain/parties'
import { landingPath } from './landing'
import { canOpen, type AppPath } from './nav'

/**
 * For a screen's `beforeLoad`: a role that may not open `path` goes to its own landing screen.
 * Hides the screen only; server functions keep their own guards (src/server/auth/README.md).
 */
export function guardScreen(role: Role, path: AppPath): void {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect
  if (!canOpen(role, path)) throw redirect({ to: landingPath(role) })
}
