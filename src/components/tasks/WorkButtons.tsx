import { Undo2 } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { cn } from '~/lib/utils'
import { completeTaskFn, releaseTaskFn, type TaskView } from '~/server/tasks/functions'
import { canWorkOn, type Me } from './taskView'
import { useTaskAction } from './useTaskAction'

export type Run = ReturnType<typeof useTaskAction>['run']

/** Hotovo for one task: the main action, with confetti and its "+N"; the toast says whether it waits. */
export function DoneButton({
  task,
  busy,
  run,
  wide = false,
}: {
  task: Pick<TaskView, 'id' | 'score'>
  busy: string | null
  run: Run
  wide?: boolean
}) {
  const doneKey = `done-${String(task.id)}`
  return (
    <Button
      variant="ok"
      disabled={busy !== null}
      aria-busy={busy === doneKey}
      className={cn(wide && 'w-full')}
      onClick={(e) => {
        void run(
          doneKey,
          () => completeTaskFn({ data: { taskId: task.id } }),
          (r) => (r.status === 'confirmed' ? cs.work.toast.done : cs.work.toast.pending),
          { confetti: e.currentTarget, float: task.score },
        )
      }}
    >
      {cs.work.done}
    </Button>
  )
}

/**
 * Hotovo and Uvolnit for the brother who has the task (spec §5.4, §5.5), on his Domů row and on
 * the task page (#150). `busy` and `run` come from the caller, so a whole board shares one busy
 * state. `wide` (the page): Hotovo is the main action, full width, Uvolnit under it. On a row,
 * ↶ Uvolnit is a 44 px icon button so the name and chip read in full at 360 px (#148).
 */
export function WorkButtons({
  task,
  busy,
  run,
  wide = false,
}: {
  task: Pick<TaskView, 'id' | 'score'>
  busy: string | null
  run: Run
  wide?: boolean
}) {
  const releaseKey = `release-${String(task.id)}`
  const done = <DoneButton key="done" task={task} busy={busy} run={run} wide={wide} />
  const release = (
    <Button
      key="release"
      variant="ghost"
      size={wide ? 'default' : 'icon'}
      aria-label={wide ? undefined : cs.work.release}
      disabled={busy !== null}
      aria-busy={busy === releaseKey}
      className={cn(wide && 'w-full')}
      onClick={() => {
        void run(
          releaseKey,
          () => releaseTaskFn({ data: { taskId: task.id } }),
          () => cs.work.toast.released,
        )
      }}
    >
      {wide ? cs.work.release : <Undo2 aria-hidden="true" />}
    </Button>
  )
  return (
    <div className={wide ? 'grid gap-2' : 'flex gap-2'}>
      {wide ? [done, release] : [release, done]}
    </div>
  )
}

/** The task page's Hotovo and Uvolnit: nothing unless this person reserved the task. */
export function TaskWorkPanel({ task, me }: { task: TaskView; me: Me }) {
  const { busy, run } = useTaskAction()
  if (!canWorkOn(task, me)) return null
  return <WorkButtons task={task} busy={busy} run={run} wide />
}
