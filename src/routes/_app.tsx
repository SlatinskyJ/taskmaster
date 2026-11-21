import { createFileRoute, Outlet, redirect, useLocation } from '@tanstack/react-router'
import { FloatLayer } from '~/components/effects/FloatLayer'
import { BottomNav } from '~/components/shell/BottomNav'
import { showsBar } from '~/lib/nav'
import { cn } from '~/lib/utils'
import { getCurrentUserFn } from '~/server/auth/functions'

// Every screen behind login lives under this pathless layout (spec §6). Nobody signed in →
// login screen, coming back here afterwards. Children get `context.user`.
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUserFn()
    if (!user) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    return { user }
  },
  component: AppLayout,
})

/** The app shell: the screen, the "+N" layer (UI doc §4), then the role's bottom bar (UI doc §6). */
function AppLayout() {
  const { user } = Route.useRouteContext()
  const { pathname } = useLocation()
  const hasBar = showsBar(user.role, pathname)
  return (
    <div className={cn('min-h-dvh', hasBar && 'pb-[calc(4.5rem+env(safe-area-inset-bottom))]')}>
      <Outlet />
      <FloatLayer />
      {hasBar && <BottomNav role={user.role} />}
    </div>
  )
}
