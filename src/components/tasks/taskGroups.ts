import { cs } from '~/lib/strings'
import type { TaskView } from '~/server/tasks/functions'

type TaskStatus = TaskView['status']

/** Úkoly's group per task state (UI doc §7.2 GTasks). A Record, so a new status must get one. */
export const GROUP_LABEL: Record<TaskStatus, string> = {
  proposed: cs.tasks.groupProposed,
  open: cs.state.open,
  reserved: cs.state.reserved,
  done_unconfirmed: cs.state.pending,
  confirmed: cs.state.confirmed,
  cancelled: cs.state.cancelled,
}

/** Active states first, finished ones last. */
export const GROUP_ORDER: readonly TaskStatus[] = [
  'proposed',
  'open',
  'reserved',
  'done_unconfirmed',
  'confirmed',
  'cancelled',
]

export interface TaskGroup {
  status: TaskStatus
  label: string
  tasks: TaskView[]
}

/** The non-empty groups in GROUP_ORDER, each keeping the list's own order. */
export function groupTasks(list: readonly TaskView[]): TaskGroup[] {
  return GROUP_ORDER.map((status) => ({
    status,
    label: GROUP_LABEL[status],
    tasks: list.filter((t) => t.status === status),
  })).filter((g) => g.tasks.length > 0)
}
