import { createFileRoute, redirect } from '@tanstack/react-router'
import { LogoutButton } from '~/components/LogoutButton'
import { cs } from '~/lib/strings'
import { landingPath } from '~/lib/landing'

// Domů for takers and givers (UI doc §6). The admin has no Domů and lands on Správa.
export const Route = createFileRoute('/_app/')({
  beforeLoad: ({ context }) => {
    const landing = landingPath(context.user.role)
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect
    if (landing !== '/') throw redirect({ to: landing })
  },
  component: Home,
})

// Placeholder until the app shell (#31) and the home screens land.
function Home() {
  const { user } = Route.useRouteContext()
  return (
    <main className="grid min-h-dvh place-items-center gap-4 p-4">
      <h1 className="text-3xl font-bold">
        {cs.home.greeting}, {user.displayName}
      </h1>
      <LogoutButton />
    </main>
  )
}
