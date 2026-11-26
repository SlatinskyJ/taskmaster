import { Link } from '@tanstack/react-router'
import { templateLink } from '~/components/tasks/rowLink'
import { TaskRow } from '~/components/tasks/TaskRow'
import { Button, buttonVariants } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { templateDetail } from '~/lib/templateText'
import type { TemplateView } from '~/server/templates/functions'
import { priceMeta, templateChip } from './priceView'

/**
 * A template on Úkoly (GTasks): an agreed one links to its price page (#138). With `onNow`, an
 * agreed one also has "+ Teď" (#38): one more instance right now. A proposed one with first-price
 * bidding (#209, `bidding` set only with the switch on) links to its page too.
 */
export function TemplateRow({
  template: t,
  onNow,
  busy = false,
  links = false,
}: {
  template: TemplateView
  onNow?: () => void
  busy?: boolean
  /** The `openRows` switch (#205): each row opens its page. */
  links?: boolean
}) {
  const active = t.status === 'active'
  const chip = templateChip(t)
  const bids = (t.change ?? t.bidding)?.bids.length ?? 0
  // A parent's turn when bids are open (same word as Domů); else he may start a change (#138),
  // or open a proposed chore's bidding (#209).
  const label = bids > 0 ? cs.bids.answer : active ? cs.templatePrice.change : cs.bids.open
  // With bids waiting, the line says who wants what, not that the brothers are slow (#209).
  const meta = active
    ? cs.templates.recurringMeta
    : t.bidding && bids > 0
      ? (priceMeta(t, { id: 0, role: 'giver' }) ?? undefined)
      : cs.tasks.waitingForTaker
  const link = (
    <Link
      to="/sablona/$templateId"
      params={{ templateId: String(t.id) }}
      className={buttonVariants({ variant: 'ghost' })}
    >
      {label}
    </Link>
  )
  return (
    <TaskRow
      name={t.title}
      state={chip.state}
      stateLabel={chip.label}
      points={t.score}
      meta={meta}
      detail={templateDetail(t)}
      action={
        active ? (
          // Stacked: two buttons side by side would squeeze the name to one word at 360 px.
          <div className="grid shrink-0 gap-2">
            {onNow && (
              <Button variant="ghost" disabled={busy} onClick={onNow}>
                {cs.instances.now}
              </Button>
            )}
            {link}
          </div>
        ) : t.bidding ? (
          link
        ) : undefined
      }
      link={links ? templateLink(t.id) : undefined}
    />
  )
}
