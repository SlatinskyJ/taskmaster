import type { ReactNode } from 'react'
import { SectionLabel } from '~/components/shell/SectionLabel'
import type { TaskView } from '~/server/tasks/functions'
import { ApprovableRow } from './ApproveControls'
import { taskLink } from './rowLink'
import { groupTasks } from './taskGroups'
import { lowestText, taskChipState } from './taskView'
import { TaskRow } from './TaskRow'
import type { Run } from './WorkButtons'

/** Úkoly's one-time tasks, one labelled group per state (UI doc §7.2 GTasks, #41). */
export function TaskGroups({
  list,
  meta,
  action,
  approve,
  links = false,
}: {
  list: readonly TaskView[]
  meta: (t: TaskView) => string | undefined
  action: (t: TaskView) => ReactNode
  /**
   * ✓ / ✕ on done work waiting for a parent (#206). The whole row is swapped for ApprovableRow,
   * not just its action, because the reason form opens under the row, outside TaskRow. Its meta
   * ("Udělal …") is what `meta` gives that state anyway, and done work has no lowest bid.
   */
  approve?: { busy: string | null; run: Run }
  /** The `openRows` switch (#205): each row opens its page. */
  links?: boolean
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
              <ApprovableRow task={t} {...approve} links={links} />
            ) : (
              <TaskRow
                name={t.title}
                state={taskChipState(t)}
                points={t.score}
                meta={meta(t)}
                detail={t.lowest ? lowestText(t.lowest) : undefined}
                action={action(t)}
                link={links ? taskLink(t.id) : undefined}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  ))
}
