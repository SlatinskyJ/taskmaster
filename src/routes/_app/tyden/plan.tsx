import { createFileRoute, redirect } from '@tanstack/react-router'
import { weekLabel } from '~/components/period/periodView'
import { Screen } from '~/components/shell/Screen'
import { Card } from '~/components/ui/card'
import { WeekPlanTable } from '~/components/week/WeekPlanTable'
import { liveSubs } from '~/lib/liveSubs'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { getWeekPlanFn } from '~/server/instances/functions'

// Plán týdne (#258, spec §5.12, UI doc §7.1 "Plan"): the running week's chores × days, opened
// from a card on Týden. Behind the `weekPlan` switch; the server answers `feature_off` too.
export const Route = createFileRoute('/_app/tyden/plan')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/tyden/plan')
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect
    if (!context.features.weekPlan) throw redirect({ to: '/tyden' })
  },
  loader: async () => {
    const live = liveSubs()
    const plan = live.take(await getWeekPlanFn())
    return { plan, live: live.all() }
  },
  component: PlanPage,
})

export function PlanPage() {
  const { user } = Route.useRouteContext()
  const { plan: data } = Route.useLoaderData()
  return (
    <Screen title={cs.plan.title} user={user} back="/tyden" wide>
      {'error' in data ? (
        <Card>
          <p className="font-bold text-muted">{cs.tasks.errors.notAllowed}</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {data.period && (
            <p data-slot="plan-week" className="-mt-2 num text-meta text-muted">
              {weekLabel(data.period.startsAt, data.period.cutoffAt)}
            </p>
          )}
          <WeekPlanTable
            plan={data}
            viewer={{ id: user.id, role: user.role === 'giver' ? 'giver' : 'taker' }}
          />
        </div>
      )}
    </Screen>
  )
}
