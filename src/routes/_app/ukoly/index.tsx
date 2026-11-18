import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { EmptyState } from '~/components/EmptyState'
import { Screen } from '~/components/shell/Screen'
import { TaskRow } from '~/components/tasks/TaskRow'
import { useTaskAction } from '~/components/tasks/useTaskAction'
import { Button, buttonVariants } from '~/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { guardScreen } from '~/lib/screenGuard'
import { cs, type ItemStateKey } from '~/lib/strings'
import { completeTaskFn, listTasksFn, releaseTaskFn, type TaskView } from '~/server/tasks/functions'

// Úkoly: all one-time tasks by state, givers only (UI doc §7.2 GTasks). A giver can release a
// reservation or mark an open task done themselves (spec §5.4–§5.5). Recurring templates join
// with #37.
export const Route = createFileRoute('/_app/ukoly/')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/ukoly')
  },
  loader: () => listTasksFn(),
  component: Tasks,
})

/** Lifecycle status (spec §5.6) → the chip's state (UI doc §2.2). */
const STATE: Record<TaskView['status'], ItemStateKey> = {
  proposed: 'proposed',
  open: 'open',
  reserved: 'reserved',
  done_unconfirmed: 'pending',
  confirmed: 'confirmed',
  cancelled: 'cancelled',
}

function Tasks() {
  const { user } = Route.useRouteContext()
  const list = Route.useLoaderData()
  const { busy, run } = useTaskAction()
  // "Hotovo bez bodů" can't be undone, so it asks first (UI doc §5).
  const [closing, setClosing] = useState<TaskView | null>(null)

  function meta(t: TaskView) {
    if (t.status === 'proposed') return cs.tasks.waitingForTaker
    if (t.status === 'reserved' && t.reservedBy) return `${cs.work.reservedBy} ${t.reservedBy.name}`
    if (t.completedBy) return `${cs.work.doneBy} ${t.completedBy.name}`
    return undefined
  }

  function action(t: TaskView) {
    if (t.status === 'reserved') {
      return (
        <Button
          variant="ghost"
          disabled={busy !== null}
          onClick={() => {
            void run(
              `release-${String(t.id)}`,
              () => releaseTaskFn({ data: { taskId: t.id } }),
              () => cs.work.toast.released,
            )
          }}
        >
          {cs.work.release}
        </Button>
      )
    }
    if (t.status === 'open') {
      return (
        <Button
          variant="ghost"
          disabled={busy !== null}
          onClick={() => {
            setClosing(t)
          }}
        >
          {cs.work.doneSelf}
        </Button>
      )
    }
    return undefined
  }
  const newButton = (
    <Link to="/ukoly/novy" className={buttonVariants({ variant: 'primary' })}>
      {cs.tasks.new}
    </Link>
  )
  return (
    <Screen title={cs.nav.tasks} user={user} action={newButton}>
      {list.length === 0 ? (
        <EmptyState>{cs.tasks.empty}</EmptyState>
      ) : (
        <ul className="grid gap-2">
          {list.map((t) => (
            <li key={t.id}>
              <TaskRow
                name={t.title}
                state={STATE[t.status]}
                points={t.score}
                meta={meta(t)}
                action={action(t)}
              />
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={closing !== null}
        onOpenChange={(open) => {
          if (!open) setClosing(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{cs.work.doneSelfConfirm.title}</DialogTitle>
            <DialogDescription>
              {closing?.title}: {cs.work.doneSelfConfirm.body}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{cs.work.back}</Button>
            </DialogClose>
            <Button
              variant="primary"
              disabled={busy !== null}
              onClick={() => {
                if (!closing) return
                const id = closing.id
                void run(
                  `done-${String(id)}`,
                  () => completeTaskFn({ data: { taskId: id } }),
                  () => cs.work.toast.done,
                ).then(() => {
                  setClosing(null)
                })
              }}
            >
              {cs.work.doneSelfConfirm.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Screen>
  )
}
