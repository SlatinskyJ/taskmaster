import type { ReactNode } from 'react'
import { SectionLabel } from '~/components/shell/SectionLabel'
import type { TaskView } from '~/server/tasks/functions'
import { ApprovableRow } from './ApproveControls'
import { groupTasks } from './taskGroups'
import { lowestText, taskChipState } from './taskView'
import { TaskLink } from './TaskLink'
import { TaskRow } from './TaskRow'
import type { Run } from './WorkButtons'

/** Úkoly's one-time tasks, one labelled group per state (UI doc §7.2 GTasks, #41). */
export function TaskGroups({
  list,
  meta,
  action,
  linked = () => false,
  approve,
}: {
  list: readonly TaskView[]
  meta: (t: TaskView) => string | undefined
  action: (t: TaskView) => ReactNode
  /** Rows whose name links to the task page (#212: free tasks with reopenBidding on). */
  linked?: (t: TaskView) => boolean
  /**
   * ✓ / ✕ on done work waiting for a parent (#206). The whole row is swapped for ApprovableRow,
   * not just its action, because the reason form opens under the row, outside TaskRow. Its meta
   * ("Udělal …") is what `meta` gives that state anyway, and done work has no lowest bid.
   */
  approve?: { busy: string | null; run: Run }
}) {
  return groupTasks(list).map((g) => (
    <section key={g.status} className="grid gap-2" aria-labelledby={`group-${g.status}`}>
      <SectionLabel id={`group-${g.status}`}>
        {g.label} ({g.tasks.length})
      </SectionLabel>
      <ul className="grid gap-2">
        {g.tasks.map((t) => (
          <li key={t.id}>
            {approve && t.status === 'done_unconfirmed' ? (
              <ApprovableRow task={t} {...approve} />
            ) : (
              <TaskRow
                name={linked(t) ? <TaskLink id={t.id} title={t.title} /> : t.title}
                state={taskChipState(t)}
                points={t.score}
                meta={meta(t)}
                detail={t.lowest ? lowestText(t.lowest) : undefined}
                action={action(t)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  ))
}
