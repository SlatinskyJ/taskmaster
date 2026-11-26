import { createFileRoute, notFound } from '@tanstack/react-router'
import { DisputeControl } from '~/components/disputes/DisputeControl'
import { templateDispute } from '~/components/disputes/disputeProps'
import { EmptyState } from '~/components/EmptyState'
import { Screen } from '~/components/shell/Screen'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { BidThread } from '~/components/tasks/BidThread'
import { StateChip } from '~/components/tasks/StateChip'
import { AgreeToChore, choreWaitingText } from '~/components/templates/ProposedChore'
import { TemplatePricePanel } from '~/components/templates/TemplatePricePanel'
import { priceMeta, templateChip } from '~/components/templates/priceView'
import { Card } from '~/components/ui/card'
import { parseIdParam } from '~/lib/idParam'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { templateDetail } from '~/lib/templateText'
import { getItemMarkFn } from '~/server/disputes/functions'
import { getTemplateDetailFn } from '~/server/templates/functions'

// A recurring template's price page (#138, TApprove "price change" / GTask "change price", UI doc
// §7): the score that applies now, the whole history of offers and bids, and what this person can
// do about it. The old score stays until someone accepts (spec §5.1). A proposed one (#205) shows
// its proposed score, who it waits for and Souhlasím; it has no price history yet.
export const Route = createFileRoute('/_app/sablona/$templateId')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/sablona/$templateId')
  },
  loader: async ({ params, context }) => {
    const templateId = parseIdParam(params.templateId)
    // TanStack Router's notFound() is thrown by design; it is not an Error.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (templateId === null) throw notFound()
    const detail = await getTemplateDetailFn({ data: { templateId } })
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (!detail) throw notFound()
    // Rozporovat (#46): the score's mark, only with the switch on and once active.
    const mark =
      context.features.disputes && detail.template.status === 'active'
        ? await getItemMarkFn({ data: { kind: 'template_score', id: detail.template.id } })
        : null
    return { ...detail, disputeMark: mark && 'error' in mark ? null : mark }
  },
  component: TemplatePage,
})

function TemplatePage() {
  const { user, features } = Route.useRouteContext()
  const { template: t, thread, waitingFor, disputeMark } = Route.useLoaderData()
  const dispute = features.disputes ? templateDispute(t) : null
  const me = { id: user.id, role: user.role }
  const chip = templateChip(t)
  const meta = priceMeta(t, me)
  const proposed = t.status === 'proposed'
  const waiting = proposed ? choreWaitingText(waitingFor, me) : null
  return (
    <Screen title={t.title} user={user} back="history">
      <Card className="grid gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StateChip state={chip.state} label={chip.label} />
          <span className="num text-title font-bold">{t.score}</span>
          <span className="text-meta text-muted">
            {t.bidding
              ? cs.templatePrice.proposedNow(t.score)
              : proposed
                ? cs.templatePrice.proposed(t.score)
                : cs.templatePrice.now(t.score)}
          </span>
        </div>
        {proposed && <p className="text-meta text-muted">{cs.templatePrice.startsWhenAll}</p>}
        {meta && <p className="font-bold break-words">{meta}</p>}
        <p className="text-meta break-words text-muted">{templateDetail(t)}</p>
        {t.status === 'active' && (
          <p className="text-meta text-muted">{cs.templatePrice.futureOnly}</p>
        )}
        {waiting && <p className="font-bold break-words">{waiting}</p>}
        {/* With first-price bidding (#209) the price panel below has Souhlasím. */}
        {proposed && !t.bidding && waitingFor.some((p) => p.id === user.id) && (
          <AgreeToChore template={t} />
        )}
        {dispute && <DisputeControl {...dispute} mark={disputeMark} lead />}
      </Card>
      {(!proposed || t.bidding) && (
        <section className="grid gap-2" aria-labelledby="history-label">
          <SectionLabel id="history-label">{cs.templatePrice.history}</SectionLabel>
          {thread.length === 0 ? (
            <EmptyState>{cs.templatePrice.noHistory}</EmptyState>
          ) : (
            <BidThread entries={thread} me={user.id} />
          )}
        </section>
      )}
      <TemplatePricePanel
        key={`${String(t.score)}-${String(thread.length)}`}
        template={t}
        me={me}
      />
    </Screen>
  )
}
