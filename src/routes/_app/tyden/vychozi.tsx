import { createFileRoute, redirect } from '@tanstack/react-router'
import { DefaultsProposalScreen } from '~/components/proposals/DefaultsProposalScreen'
import { Screen } from '~/components/shell/Screen'
import { Card } from '~/components/ui/card'
import { liveSubs } from '~/lib/liveSubs'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { getProposalsFn } from '~/server/periods/functions'

// Výchozí týden for parents (#43, spec §5.8, UI doc §7.2 GDefaults): propose a new default week.
// Giver only; behind the `periodProposals` switch.
export const Route = createFileRoute('/_app/tyden/vychozi')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/tyden/vychozi')
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect
    if (!context.features.periodProposals) throw redirect({ to: '/tyden' })
  },
  loader: async () => {
    const live = liveSubs()
    const proposals = live.take(await getProposalsFn())
    return { proposals, live: live.all() }
  },
  component: DefaultsPage,
})

export function DefaultsPage() {
  const { user } = Route.useRouteContext()
  const { proposals: data } = Route.useLoaderData()
  return (
    <Screen title={cs.proposals.defaultsTitle} user={user} back="/tyden/pristi">
      {'error' in data ? (
        <Card>
          <p className="font-bold text-muted">{cs.proposals.errors.forbidden}</p>
        </Card>
      ) : (
        <DefaultsProposalScreen view={data} me={user.id} />
      )}
    </Screen>
  )
}
