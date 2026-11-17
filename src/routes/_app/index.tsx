import { createFileRoute, redirect } from '@tanstack/react-router'
import { Placeholder } from '~/components/shell/Placeholder'
import { Screen } from '~/components/shell/Screen'
import { landingPath } from '~/lib/landing'
import { cs } from '~/lib/strings'

// Domů for takers and givers (UI doc §6). The admin has no Domů and lands on Správa.
export const Route = createFileRoute('/_app/')({
  beforeLoad: ({ context }) => {
    const landing = landingPath(context.user.role)
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect
    if (landing !== '/') throw redirect({ to: landing })
  },
  component: Home,
})

// The taker and giver home screens fill this in (#40, #41).
function Home() {
  const { user } = Route.useRouteContext()
  return (
    <Screen title={`${cs.home.greeting}, ${user.displayName}!`} user={user}>
      <Placeholder />
    </Screen>
  )
}
