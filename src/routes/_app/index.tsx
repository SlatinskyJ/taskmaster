import { createFileRoute, redirect } from '@tanstack/react-router'
import { EmptyState } from '~/components/EmptyState'
import { Card } from '~/components/ui/card'
import { landingPath } from '~/lib/landing'
import { cs } from '~/lib/strings'

// Domů for takers and givers (UI doc §6). The admin has no Domů and lands on Správa.
export const Route = createFileRoute('/_app/')({
  beforeLoad: ({ context }) => {
    const landing = landingPath(context.user.role)
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect
    if (landing !== '/') throw redirect({ to: landing })
  },
  component: Home,
})

// Placeholder until the home screens (#40 taker, #41 giver).
function Home() {
  const { user } = Route.useRouteContext()
  return (
    <div className="grid gap-4">
      <h1 className="text-title font-bold">
        {cs.home.greeting}, {user.displayName}!
      </h1>
      <Card>
        <EmptyState>{cs.shell.comingSoon}</EmptyState>
      </Card>
    </div>
  )
}
