import { createFileRoute } from '@tanstack/react-router'
import { Screen } from '~/components/shell/Screen'
import { freeCount } from '~/components/week/planView'
import { WeekScreen } from '~/components/week/WeekScreen'
import { liveSubs } from '~/lib/liveSubs'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { getDisputeListFn } from '~/server/disputes/functions'
import { getWeekPlanFn } from '~/server/instances/functions'
import { getProposalsFn } from '~/server/periods/functions'
import { getWeekFn } from '~/server/settlement/functions'

// Týden: this period and the settled weeks, takers and givers (spec §5.7–§5.9, UI doc §6, §7.1).
// A taker sees only himself; the server filters that (getWeekFn).
export const Route = createFileRoute('/_app/tyden/')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/tyden')
  },
  loader: async ({ context }) => {
    const live = liveSubs()
    return {
      week: live.take(await getWeekFn()),
      // Příští týden card (#43): only with the launch switch on, so off means no call.
      proposals: context.features.periodProposals ? live.take(await getProposalsFn()) : null,
      // Rozporováno (#46): only with the disputes switch on.
      disputeList: context.features.disputes ? live.take(await getDisputeListFn()) : null,
      // Plán týdne card (#258): only with the weekPlan switch on.
      plan: context.features.weekPlan ? live.take(await getWeekPlanFn()) : null,
      live: live.all(),
    }
  },
  component: WeekPage,
})

function WeekPage() {
  const { user, features } = Route.useRouteContext()
  const { week, proposals, disputeList, plan } = Route.useLoaderData()
  const giver = user.role === 'giver'
  return (
    <Screen title={giver ? cs.nav.week : cs.week.myTitle} user={user}>
      <WeekScreen
        week={week}
        viewerRole={giver ? 'giver' : 'taker'}
        disputes={features.disputes}
        links={features.openRows}
        disputeList={disputeList && !('error' in disputeList) ? disputeList : []}
        plan={plan && !('error' in plan) ? { free: freeCount(plan) } : undefined}
        nextWeek={
          proposals && !('error' in proposals)
            ? {
                pending:
                  proposals.period?.status === 'pending' ||
                  proposals.defaults?.status === 'pending',
              }
            : undefined
        }
      />
    </Screen>
  )
}
