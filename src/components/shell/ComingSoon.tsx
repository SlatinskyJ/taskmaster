import { EmptyState } from '~/components/EmptyState'
import { Card } from '~/components/ui/card'
import { cs } from '~/lib/strings'

/** An empty screen with its title, until the feature behind its tab lands. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="grid gap-4">
      <h1 className="text-title font-bold">{title}</h1>
      <Card>
        <EmptyState>{cs.shell.comingSoon}</EmptyState>
      </Card>
    </div>
  )
}
