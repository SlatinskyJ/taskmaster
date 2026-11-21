import { Link } from '@tanstack/react-router'
import { TaskRow } from '~/components/tasks/TaskRow'
import { buttonVariants } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { templateDetail } from '~/lib/templateText'
import type { TemplateView } from '~/server/templates/functions'
import { templateChip } from './priceView'

/** A template on Úkoly (GTasks): an agreed one links to its price page (#138). */
export function TemplateRow({ template: t }: { template: TemplateView }) {
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
          <Link
            to="/sablona/$templateId"
            params={{ templateId: String(t.id) }}
            className={buttonVariants({ variant: 'ghost' })}
          >
            {label}
          </Link>
        ) : undefined
      }
    />
  )
}
