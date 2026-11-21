import { Ban } from 'lucide-react'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Textarea } from '~/components/ui/textarea'
import { cs } from '~/lib/strings'
import { scoreChangeErrorMessage } from '~/lib/taskErrors'
import { REASON_MAX } from '~/lib/taskLimits'
import { cancelTaskFn, type TaskView } from '~/server/tasks/functions'
import type { Me } from './taskView'
import { useTaskAction } from './useTaskAction'

type Run = ReturnType<typeof useTaskAction>['run']

/** A giver may cancel anything not yet completed (spec §5.6 [call]). */
export function canCancel(task: Pick<TaskView, 'status'>, me: Me): boolean {
  return (
    me.role === 'giver' &&
    (task.status === 'proposed' || task.status === 'open' || task.status === 'reserved')
  )
}

/**
 * "Zrušit úkol" on the task page (#36, mockup GTask). It can't be undone, so it asks first
 * (UI doc §5: Dialog), with an optional reason everyone sees in the history.
 */
export function CancelTask({ task, me }: { task: TaskView; me: Me }) {
  const { busy, run } = useTaskAction()
  const [open, setOpen] = useState(false)
  if (!canCancel(task, me)) return null
  return (
    <>
      <Button
        variant="ghost"
        className="h-auto min-h-tap w-full justify-start gap-3 px-3.5 py-2 text-left whitespace-normal text-destructive"
        onClick={() => {
          setOpen(true)
        }}
      >
        <Ban aria-hidden="true" />
        <span className="grid">
          <span>{cs.cancelTask.action}</span>
          <span className="font-body text-meta font-bold text-muted">{cs.cancelTask.hint}</span>
        </span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{cs.cancelTask.title}</DialogTitle>
            <DialogDescription>{cs.cancelTask.body}</DialogDescription>
          </DialogHeader>
          <CancelForm
            task={task}
            busy={busy}
            run={run}
            onDone={() => {
              setOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

/** What "Zrušit úkol" sends: the reason trimmed, or none when blank. */
export function cancelData(taskId: number, reason: string): { taskId: number; reason?: string } {
  const text = reason.trim()
  return text ? { taskId, reason: text } : { taskId }
}

/** The Dialog's body: the reason field and the two buttons. Closes only on success. */
export function CancelForm({
  task,
  busy,
  run,
  onDone,
}: {
  task: Pick<TaskView, 'id'>
  busy: string | null
  run: Run
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const key = `cancel-${String(task.id)}`
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void run(
          key,
          () => cancelTaskFn({ data: cancelData(task.id, reason) }),
          () => cs.cancelTask.done,
          { errorMessage: scoreChangeErrorMessage },
        ).then((ok) => {
          if (ok) onDone()
        })
      }}
    >
      <label className="grid gap-1.5">
        <span className="text-meta font-bold text-muted">{cs.cancelTask.reason}</span>
        <Textarea
          name="reason"
          maxLength={REASON_MAX}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
          }}
        />
      </label>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {cs.cancelTask.back}
        </Button>
        <Button type="submit" variant="no" disabled={busy !== null} aria-busy={busy === key}>
          {cs.cancelTask.confirm}
        </Button>
      </DialogFooter>
    </form>
  )
}
