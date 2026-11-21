import { createFileRoute, Outlet, redirect, useLocation } from '@tanstack/react-router'
import { FloatLayer } from '~/components/effects/FloatLayer'
import { BottomNav } from '~/components/shell/BottomNav'
import { showsBar } from '~/lib/nav'
import { clientCache } from '~/lib/clientCache'
import { cn } from '~/lib/utils'
import { getCurrentUserFn } from '~/server/auth/functions'
import { getFeaturesFn } from '~/server/features/functions'

// Every screen behind login lives under this pathless layout (spec §6). Nobody signed in →
// login screen, coming back here afterwards. Children get `context.user` and the launch switches
// as `context.features`.

/** The launch switches change rarely: fetched once per page load (and again after an hour in an
 * app left open), not on every screen change. The server render always reads the database. */
const loadFeatures = clientCache(() => getFeaturesFn(), 60 * 60 * 1000)

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUserFn()
    if (!user) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    const features = await loadFeatures()
    return { user, features }
  },
  component: AppLayout,
})

/** The app shell: the screen, the "+N" layer (UI doc §4), then the role's bottom bar (UI doc §6). */
function AppLayout() {
  const { user, features } = Route.useRouteContext()
  const { pathname } = useLocation()
  const hasBar = showsBar(user.role, pathname, features)
  return (
    <div className={cn('min-h-dvh', hasBar && 'pb-[calc(4.5rem+env(safe-area-inset-bottom))]')}>
      <Outlet />
      <FloatLayer />
      {hasBar && <BottomNav role={user.role} features={features} />}
    </div>
  )
}
