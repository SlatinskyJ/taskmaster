import { Link } from '@tanstack/react-router'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { taskChipState, waitingText, type Me } from '~/components/tasks/taskView'
import { TaskRow } from '~/components/tasks/TaskRow'
import { buttonVariants } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import type { TaskView } from '~/server/tasks/functions'

/**
 * "Čeká na kluky" on a parent's Domů (#41 "approvals waiting", mockup GHome): offers a brother
 * still has to say yes to, with who it waits for. Renders nothing when there are none.
 */
export function WaitingOnTakers({ items, me }: { items: readonly TaskView[]; me: Me }) {
  if (items.length === 0) return null
  return (
    <section className="grid gap-2" aria-labelledby="waiting-on-takers-label">
      <SectionLabel id="waiting-on-takers-label">
        {cs.home.waitingOnTakers} ({items.length})
      </SectionLabel>
      <ul className="grid gap-2">
        {items.map((task) => (
          <li key={task.id}>
            <TaskRow
              name={task.title}
              state={taskChipState(task)}
              points={task.score}
              detail={waitingText(task, me) ?? undefined}
              action={
                <Link
                  to="/ukol/$taskId"
                  params={{ taskId: String(task.id) }}
                  className={buttonVariants({ variant: 'ghost' })}
                >
                  {cs.bids.open}
                </Link>
              }
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
