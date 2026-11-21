import { createFileRoute, notFound } from '@tanstack/react-router'
import { EmptyState } from '~/components/EmptyState'
import { Screen } from '~/components/shell/Screen'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { BidThread } from '~/components/tasks/BidThread'
import { StateChip } from '~/components/tasks/StateChip'
import { parseIdParam } from '~/components/tasks/taskView'
import { TemplatePricePanel } from '~/components/templates/TemplatePricePanel'
import { priceMeta, templateChip } from '~/components/templates/priceView'
import { Card } from '~/components/ui/card'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { templateDetail } from '~/lib/templateText'
import { getTemplateDetailFn } from '~/server/templates/functions'

// A recurring template's price page (#138, TApprove "price change" / GTask "change price", UI doc
// §7): the score that applies now, the whole history of offers and bids, and what this person can
// do about it. The old score stays until someone accepts (spec §5.1).
export const Route = createFileRoute('/_app/sablona/$templateId')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/sablona/$templateId')
  },
  loader: async ({ params }) => {
    const templateId = parseIdParam(params.templateId)
    // TanStack Router's notFound() is thrown by design; it is not an Error.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (templateId === null) throw notFound()
    const detail = await getTemplateDetailFn({ data: { templateId } })
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (!detail) throw notFound()
    return detail
  },
  component: TemplatePage,
})

function TemplatePage() {
  const { user } = Route.useRouteContext()
  const { template: t, thread } = Route.useLoaderData()
  const me = { id: user.id, role: user.role }
  const chip = templateChip(t)
  const meta = priceMeta(t, me)
  return (
    <Screen title={t.title} user={user} back="/">
      <Card className="grid gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StateChip state={chip.state} label={chip.label} />
          <span className="num text-title font-bold">{t.score}</span>
          <span className="text-meta text-muted">{cs.templatePrice.now(t.score)}</span>
        </div>
        {meta && <p className="font-bold break-words">{meta}</p>}
        <p className="text-meta break-words text-muted">{templateDetail(t)}</p>
        {t.status === 'active' && (
          <p className="text-meta text-muted">{cs.templatePrice.futureOnly}</p>
        )}
      </Card>
      <section className="grid gap-2" aria-labelledby="history-label">
        <SectionLabel id="history-label">{cs.templatePrice.history}</SectionLabel>
        {thread.length === 0 ? (
          <EmptyState>{cs.templatePrice.noHistory}</EmptyState>
        ) : (
          <BidThread entries={thread} me={user.id} />
        )}
      </section>
      <TemplatePricePanel
        key={`${String(t.score)}-${String(thread.length)}`}
        template={t}
        me={me}
      />
    </Screen>
  )
}
