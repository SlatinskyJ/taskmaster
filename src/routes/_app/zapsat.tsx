import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '~/components/shell/Placeholder'
import { Screen } from '~/components/shell/Screen'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'

// Zapsat: a taker logs a chore done unprompted (UI doc §6, §7). Content comes with #38.
export const Route = createFileRoute('/_app/zapsat')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/zapsat')
  },
  component: LogChore,
})

function LogChore() {
  const { user } = Route.useRouteContext()
  return (
    <Screen title={cs.nav.log} user={user}>
      <Placeholder />
    </Screen>
  )
}
