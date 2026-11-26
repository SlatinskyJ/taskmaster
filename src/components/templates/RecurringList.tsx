import { Link } from '@tanstack/react-router'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { templateLink } from '~/components/tasks/rowLink'
import { TaskRow } from '~/components/tasks/TaskRow'
import { buttonVariants } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { templateDetail } from '~/lib/templateText'
import type { TemplateView } from '~/server/templates/functions'
import { templateChip } from './priceView'

/**
 * A brother's "Opakované úkoly" on Domů (#138): agreed templates, each with "Jiná cena" to its
 * price page, so he can start a score change (spec §5.1: any party may propose). Moves to the
 * Zapsat tiles when #38 builds them. One already in "Čeká na tebe" (`waiting`) is left out, so
 * it isn't listed twice. Renders nothing when there are none.
 */
export function RecurringList({
  items,
  waiting,
  links = false,
}: {
  items: readonly TemplateView[]
  waiting: readonly TemplateView[]
  /** The `openRows` switch (#205): each row opens its page. */
  links?: boolean
}) {
  const agreed = items.filter((t) => t.status === 'active' && !waiting.some((w) => w.id === t.id))
  if (agreed.length === 0) return null
  return (
    <section className="grid gap-2" aria-labelledby="recurring-label">
      <SectionLabel id="recurring-label">{cs.templatePrice.recurring}</SectionLabel>
      <ul className="grid gap-2">
        {agreed.map((t) => {
          const chip = templateChip(t)
          return (
            <li key={t.id}>
              <TaskRow
                described={t.description !== null}
                name={t.title}
                state={chip.state}
                stateLabel={chip.label}
                points={t.score}
                detail={templateDetail(t)}
                action={
                  <Link
                    to="/sablona/$templateId"
                    params={{ templateId: String(t.id) }}
                    className={buttonVariants({ variant: 'ghost' })}
                  >
                    {cs.bids.otherPriceShort}
                  </Link>
                }
                link={links ? templateLink(t.id) : undefined}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
