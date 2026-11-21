import type { ReactNode } from 'react'
import { SectionLabel } from '~/components/shell/SectionLabel'
import type { TaskView } from '~/server/tasks/functions'
import { groupTasks } from './taskGroups'
import { lowestText, taskChipState } from './taskView'
import { TaskRow } from './TaskRow'

/** Úkoly's one-time tasks, one labelled group per state (UI doc §7.2 GTasks, #41). */
export function TaskGroups({
  list,
  meta,
  action,
}: {
  list: readonly TaskView[]
  meta: (t: TaskView) => string | undefined
  action: (t: TaskView) => ReactNode
}) {
  return groupTasks(list).map((g) => (
    <section key={g.status} className="grid gap-2" aria-labelledby={`group-${g.status}`}>
      <SectionLabel id={`group-${g.status}`}>
        {g.label} ({g.tasks.length})
      </SectionLabel>
      <ul className="grid gap-2">
        {g.tasks.map((t) => (
          <li key={t.id}>
            <TaskRow
              name={t.title}
              state={taskChipState(t)}
              points={t.score}
              meta={meta(t)}
              detail={t.lowest ? lowestText(t.lowest) : undefined}
              action={action(t)}
            />
          </li>
        ))}
      </ul>
    </section>
  ))
}
