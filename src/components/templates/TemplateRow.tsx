import { Link } from '@tanstack/react-router'
import { templateLink } from '~/components/tasks/rowLink'
import { TaskRow } from '~/components/tasks/TaskRow'
import { Button, buttonVariants } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { templateDetail } from '~/lib/templateText'
import type { TemplateView } from '~/server/templates/functions'
import { templateChip } from './priceView'

/**
 * A template on Úkoly (GTasks): an agreed one links to its price page (#138). With `onNow`, an
 * agreed one also has "+ Teď" (#38): one more instance right now.
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
  // A parent's turn when bids are open (same word as Domů); else he may start a change (#138).
  const label = (t.change?.bids.length ?? 0) > 0 ? cs.bids.answer : cs.templatePrice.change
  return (
    <TaskRow
      name={t.title}
      state={chip.state}
      stateLabel={chip.label}
      points={t.score}
      meta={active ? cs.templates.recurringMeta : cs.tasks.waitingForTaker}
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
            <Link
              to="/sablona/$templateId"
              params={{ templateId: String(t.id) }}
              className={buttonVariants({ variant: 'ghost' })}
            >
              {label}
            </Link>
          </div>
        ) : undefined
      }
      link={links ? templateLink(t.id) : undefined}
    />
  )
}
