import { Link } from '@tanstack/react-router'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { buttonVariants } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import type { TaskView } from '~/server/tasks/functions'
import { lowestText } from './taskView'
import { TaskRow } from './TaskRow'

/**
 * "Vyjednávání" on a parent's Domů (mockup GHome): offers the brothers bid on, with the lowest
 * bid, each a link to its page to answer. Renders nothing when there are none.
 */
export function BidsToAnswer({ items }: { items: readonly TaskView[] }) {
  if (items.length === 0) return null
  return (
    <section className="grid gap-2" aria-labelledby="bids-label">
      <SectionLabel id="bids-label">
        {cs.bids.toAnswer} ({items.length})
      </SectionLabel>
      <ul className="grid gap-2">
        {items.map((task) => (
          <li key={task.id}>
            <TaskRow
              name={task.title}
              state="negotiating"
              points={task.score}
              detail={task.lowest ? lowestText(task.lowest) : undefined}
              action={
                <Link
                  to="/ukol/$taskId"
                  params={{ taskId: String(task.id) }}
                  className={buttonVariants({ variant: 'ghost' })}
                >
                  {cs.bids.answer}
                </Link>
              }
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
