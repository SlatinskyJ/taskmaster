import { createFileRoute } from '@tanstack/react-router'
import { MeetingScreen } from '~/components/meeting/MeetingScreen'
import { Screen } from '~/components/shell/Screen'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { getWeekPlanFn } from '~/server/instances/functions'
import { getMeetingFn } from '~/server/settlement/functions'
import { listPlanTasksFn } from '~/server/tasks/functions'

// Schůzka: the weekly meeting, givers only (spec §5.9, UI doc §6, §7.3). With the `weekPlan`
// switch on, the week plan is fetched only on the Prague day of the latest settlement (#259).
export const Route = createFileRoute('/_app/schuzka')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/schuzka')
  },
  loader: async ({ context }) => {
    const meeting = await getMeetingFn()
    return {
      meeting,
      plan: await listPlanTasksFn(),
      weekPlan: context.features.weekPlan && meeting.settledToday ? await getWeekPlanFn() : null,
    }
  },
  component: Meeting,
})

function Meeting() {
  const { user, features } = Route.useRouteContext()
  const { meeting, plan, weekPlan } = Route.useLoaderData()
  return (
    <MeetingScreen
      meeting={meeting}
      plan={plan}
      otherLevels={features.periodProposals}
      weekPlan={weekPlan}
      viewerId={user.id}
      frame={(body, wide) => (
        <Screen title={cs.nav.meeting} user={user} wide={wide}>
          {body}
        </Screen>
      )}
    />
  )
}
