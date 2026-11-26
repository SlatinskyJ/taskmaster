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

/**
 * The task and chore pages (#222): a giver or taker as `guardScreen` says; the admin reads them
 * only while the `disputes` switch is on (from a Sporné card on Správa), else goes to Správa.
 */
export function guardDisputeReader(
  role: Role,
  path: '/ukol/$taskId' | '/sablona/$templateId',
  disputesOn: boolean,
): void {
  if (role === 'admin' && disputesOn) return
  guardScreen(role, path)
}
