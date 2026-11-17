import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '~/components/shell/Placeholder'
import { Screen } from '~/components/shell/Screen'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'

// Domů for takers and givers (UI doc §6). The admin has no Domů and lands on Správa.
export const Route = createFileRoute('/_app/')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/')
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
