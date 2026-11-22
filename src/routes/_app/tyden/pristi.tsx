import { createFileRoute, redirect } from '@tanstack/react-router'
import { NextWeekScreen } from '~/components/proposals/NextWeekScreen'
import { Screen } from '~/components/shell/Screen'
import { Card } from '~/components/ui/card'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { getProposalsFn } from '~/server/periods/functions'

// Příští týden (#43, spec §5.8, UI doc §7.2 Period): next week's proposal, who agreed, propose.
// Behind the `periodProposals` switch; the server answers `feature_off` too.
export const Route = createFileRoute('/_app/tyden/pristi')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/tyden/pristi')
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect
    if (!context.features.periodProposals) throw redirect({ to: '/tyden' })
  },
  loader: () => getProposalsFn(),
  component: NextWeekPage,
})

export function NextWeekPage() {
  const { user } = Route.useRouteContext()
  const data = Route.useLoaderData()
  return (
    <Screen title={cs.proposals.title} user={user} back="/tyden">
      {'error' in data ? (
        <Card>
          <p className="font-bold text-muted">{cs.proposals.errors.forbidden}</p>
        </Card>
      ) : (
        <NextWeekScreen
          view={data}
          me={{ id: user.id, role: user.role === 'giver' ? 'giver' : 'taker' }}
        />
      )}
    </Screen>
  )
}
