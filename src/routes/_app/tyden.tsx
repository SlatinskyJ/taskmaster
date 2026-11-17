import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '~/components/shell/Placeholder'
import { Screen } from '~/components/shell/Screen'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'

// Týden: this period and settlement history, takers and givers (UI doc §6, §7). Content comes with #45.
export const Route = createFileRoute('/_app/tyden')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/tyden')
  },
  component: Week,
})

function Week() {
  const { user } = Route.useRouteContext()
  return (
    <Screen title={cs.nav.week} user={user}>
      <Placeholder />
    </Screen>
  )
}
