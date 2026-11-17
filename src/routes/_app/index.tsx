import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '~/components/shell/Placeholder'
import { Screen } from '~/components/shell/Screen'
import { WaitingForYou } from '~/components/tasks/WaitingForYou'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { listPendingApprovalsFn } from '~/server/tasks/functions'

// Domů for takers and givers (UI doc §6). The admin has no Domů and lands on Správa.
export const Route = createFileRoute('/_app/')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/')
  },
  loader: () => listPendingApprovalsFn(),
  component: Home,
})

// "Čeká na tebe" first; the rest of the taker and giver home screens comes with #40, #41.
function Home() {
  const { user } = Route.useRouteContext()
  const waiting = Route.useLoaderData()
  return (
    <Screen title={`${cs.home.greeting}, ${user.displayName}!`} user={user}>
      <WaitingForYou items={waiting} />
      <Placeholder />
    </Screen>
  )
}
