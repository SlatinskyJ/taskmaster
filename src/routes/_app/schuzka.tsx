import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '~/components/shell/Placeholder'
import { Screen } from '~/components/shell/Screen'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'

// Schůzka: the weekly meeting, givers only (UI doc §6, §7). Content comes with #44.
export const Route = createFileRoute('/_app/schuzka')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/schuzka')
  },
  component: Meeting,
})

function Meeting() {
  const { user } = Route.useRouteContext()
  return (
    <Screen title={cs.nav.meeting} user={user}>
      <Placeholder />
    </Screen>
  )
}
