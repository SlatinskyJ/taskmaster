import { createFileRoute, Link, Outlet, redirect } from '@tanstack/react-router'
import { Avatar } from '~/components/shell/Avatar'
import { BottomNav } from '~/components/shell/BottomNav'
import { NAV } from '~/lib/nav'
import { cs } from '~/lib/strings'
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
  component: AppShell,
})

/**
 * The frame every screen lives in (UI doc §6): a top bar with the avatar that opens the profile,
 * the screen, and the role's bottom bar (none for the admin).
 */
function AppShell() {
  const { user } = Route.useRouteContext()
  const items = NAV[user.role]
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between px-gutter py-2">
          <span className="font-display text-xl font-bold text-accent-strong">{cs.app.name}</span>
          <Link
            to="/profil"
            aria-label={`${cs.shell.openProfile}: ${user.displayName}`}
            className="grid size-tap place-items-center rounded-full"
          >
            <Avatar name={user.displayName} />
          </Link>
        </div>
      </header>
      <main className={`mx-auto max-w-lg px-gutter pt-2 ${items.length > 0 ? 'pb-28' : 'pb-8'}`}>
        <Outlet />
      </main>
      {items.length > 0 ? <BottomNav items={items} /> : null}
    </div>
  )
}
