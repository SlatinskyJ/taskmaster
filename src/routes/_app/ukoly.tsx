import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '~/components/shell/Placeholder'
import { Screen } from '~/components/shell/Screen'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'

// Úkoly: all tasks by state, givers only (UI doc §6, §7). Content comes with #41.
export const Route = createFileRoute('/_app/ukoly')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/ukoly')
  },
  component: Tasks,
})

function Tasks() {
  const { user } = Route.useRouteContext()
  return (
    <Screen title={cs.nav.tasks} user={user}>
      <Placeholder />
    </Screen>
  )
}
