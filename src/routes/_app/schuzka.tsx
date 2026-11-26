import { createFileRoute } from '@tanstack/react-router'
import { MeetingScreen } from '~/components/meeting/MeetingScreen'
import { Screen } from '~/components/shell/Screen'
import { liveSubs } from '~/lib/liveSubs'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { getMeetingFn } from '~/server/settlement/functions'
import { listPlanTasksFn } from '~/server/tasks/functions'

// Schůzka: the weekly meeting, givers only (spec §5.9, UI doc §6, §7.3).
export const Route = createFileRoute('/_app/schuzka')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/schuzka')
  },
  loader: async () => {
    const live = liveSubs()
    const meeting = await getMeetingFn()
    const plan = live.take(await listPlanTasksFn())
    return { meeting, plan, live: live.all() }
  },
  component: Meeting,
})

function Meeting() {
  const { user, features } = Route.useRouteContext()
  const { meeting, plan } = Route.useLoaderData()
  return (
    <Screen title={cs.nav.meeting} user={user}>
      <MeetingScreen meeting={meeting} plan={plan} otherLevels={features.periodProposals} />
    </Screen>
  )
}
