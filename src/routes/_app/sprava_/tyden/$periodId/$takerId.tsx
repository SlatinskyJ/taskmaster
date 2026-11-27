import { createFileRoute, notFound } from '@tanstack/react-router'
import { AdminWeekScreen } from '~/components/admin/AdminWeekScreen'
import { Screen } from '~/components/shell/Screen'
import { parseIdParam } from '~/lib/idParam'
import { liveSubs } from '~/lib/liveSubs'
import { guardAdminWeek } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { getAdminWeekFn } from '~/server/settlement/functions'

// A brother's week for the admin (#263), opened from a settlement or adjustment card on Sporné:
// read-only, only while the `disputes` switch is on. Not nested in Správa's screen.
export const Route = createFileRoute('/_app/sprava_/tyden/$periodId/$takerId')({
  beforeLoad: ({ context }) => {
    guardAdminWeek(context.user.role, context.features.disputes)
  },
  loader: async ({ params }) => {
    const periodId = parseIdParam(params.periodId)
    const takerId = parseIdParam(params.takerId)
    // TanStack Router's notFound() is thrown by design; it is not an Error.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (periodId === null || takerId === null) throw notFound()
    const live = liveSubs()
    const week = live.take(await getAdminWeekFn({ data: { periodId, takerId } }))
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (week === null || 'error' in week) throw notFound()
    return { week, live: live.all() }
  },
  component: AdminWeekPage,
})

function AdminWeekPage() {
  const { user } = Route.useRouteContext()
  const { week } = Route.useLoaderData()
  return (
    <Screen title={cs.admin.week.title(week.taker.name)} back="/sprava" user={user} fullTitle>
      <AdminWeekScreen week={week} />
    </Screen>
  )
}
