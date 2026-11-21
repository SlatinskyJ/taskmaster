import { createFileRoute } from '@tanstack/react-router'
import { Screen } from '~/components/shell/Screen'
import { WeekScreen } from '~/components/week/WeekScreen'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { getWeekFn } from '~/server/settlement/functions'

// Týden: this period and the settled weeks, takers and givers (spec §5.7–§5.9, UI doc §6, §7.1).
// A taker sees only himself; the server filters that (getWeekFn).
export const Route = createFileRoute('/_app/tyden')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/tyden')
  },
  loader: () => getWeekFn(),
  component: WeekPage,
})

function WeekPage() {
  const { user } = Route.useRouteContext()
  const week = Route.useLoaderData()
  const giver = user.role === 'giver'
  return (
    <Screen title={giver ? cs.nav.week : cs.week.myTitle} user={user}>
      <WeekScreen week={week} viewerRole={giver ? 'giver' : 'taker'} />
    </Screen>
  )
}
