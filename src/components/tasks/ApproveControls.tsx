import { Check, X } from 'lucide-react'
import { useRef, useState, type Ref } from 'react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { cs } from '~/lib/strings'
import { REASON_MAX } from '~/lib/taskLimits'
import { approveTaskFn, rejectTaskFn, type TaskView } from '~/server/tasks/functions'
import { taskLink } from './rowLink'
import { canApprove, type Me } from './taskView'
import { TaskRow } from './TaskRow'
import { useTaskAction } from './useTaskAction'
import type { Run } from './WorkButtons'

// ✓ Schválit / ✕ Zamítnout for done work waiting for a parent (spec §5.5): on Domů's Ke schválení,
// Úkoly's Čeká na potvrzení (#206) and the task page (#206). One reason form for all three.

/** Schválit: counts the points, with confetti and the "+N" over the pressed button. */
function approve(task: Pick<TaskView, 'id' | 'score'>, run: Run, el: Element) {
  void run(
    `approve-${String(task.id)}`,
    () => approveTaskFn({ data: { taskId: task.id } }),
    () => cs.work.toast.approved,
    { confetti: el, float: task.score },
  )
}

/**
 * The reject form's submit, without a DOM: a blank reason is none; `onClose` only once the
 * server took it, so a refused or failed reject keeps the form and the typed reason.
 */
export async function submitReject(
  taskId: number,
  reason: string,
  run: Run,
  onClose: () => void,
): Promise<void> {
  const ok = await run(
    `reject-${String(taskId)}`,
    () => rejectTaskFn({ data: { taskId, reason: reason.trim() || undefined } }),
    () => cs.work.toast.rejected,
  )
  if (ok) onClose()
}

/** The optional reason, then Zpět / Zamítnout. The task goes back to its taker (spec §5.5). */
export function RejectForm({
  taskId,
  busy,
  run,
  onClose,
}: {
  taskId: number
  busy: string | null
  run: Run
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  return (
    <form
      className="grid gap-2 rounded-card bg-surface p-3 shadow-sticker"
      onSubmit={(e) => {
        e.preventDefault()
        void submitReject(taskId, reason, run, onClose)
      }}
    >
      <label className="grid gap-1.5">
        <span className="text-meta font-bold text-muted">{cs.work.rejectReason}</span>
        <Input
          name="reason"
          autoFocus
          enterKeyHint="send"
          maxLength={REASON_MAX}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
          }}
        />
      </label>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
          {cs.work.back}
        </Button>
        <Button type="submit" variant="no" className="flex-1" disabled={busy !== null}>
          {cs.work.reject}
        </Button>
      </div>
    </form>
  )
}

/** A row's ✕ and ✓ as 44 px icon buttons, so the name, chip and who did it read at 360 px (#131). */
export function ApproveIcons({
  task,
  busy,
  run,
  onReject,
  rejectRef,
}: {
  task: Pick<TaskView, 'id' | 'score'>
  busy: string | null
  run: Run
  onReject: () => void
  rejectRef?: Ref<HTMLButtonElement>
}) {
  return (
    <div className="flex gap-1.5">
      <Button
        ref={rejectRef}
        variant="no"
        size="icon"
        aria-label={cs.work.reject}
        disabled={busy !== null}
        onClick={onReject}
      >
        <X aria-hidden="true" />
      </Button>
      <Button
        variant="ok"
        size="icon"
        aria-label={cs.work.approve}
        disabled={busy !== null}
        aria-busy={busy === `approve-${String(task.id)}`}
        onClick={(e) => {
          approve(task, run, e.currentTarget)
        }}
      >
        <Check aria-hidden="true" />
      </Button>
    </div>
  )
}

/** The task page's Schválit and Zamítnout, labelled and full width. */
export function ApproveWide({
  task,
  busy,
  run,
  onReject,
  rejectRef,
}: {
  task: Pick<TaskView, 'id' | 'score'>
  busy: string | null
  run: Run
  onReject: () => void
  rejectRef?: Ref<HTMLButtonElement>
}) {
  return (
    <div className="grid gap-2">
      <Button
        variant="ok"
        className="w-full"
        disabled={busy !== null}
        aria-busy={busy === `approve-${String(task.id)}`}
        onClick={(e) => {
          approve(task, run, e.currentTarget)
        }}
      >
        {cs.work.approve}
      </Button>
      <Button
        ref={rejectRef}
        variant="no"
        className="w-full"
        disabled={busy !== null}
        onClick={onReject}
      >
        {cs.work.reject}
      </Button>
    </div>
  )
}

/** Zamítnout swaps the buttons for the form; Zpět brings focus back to Zamítnout. */
function useRejecting() {
  const [open, setOpen] = useState(false)
  const rejectRef = useRef<HTMLButtonElement>(null)
  return {
    open,
    rejectRef,
    start: () => {
      setOpen(true)
    },
    close: () => {
      setOpen(false)
      requestAnimationFrame(() => {
        rejectRef.current?.focus()
      })
    },
  }
}

/** One done task waiting for a parent, as a row: who did it, ✕ and ✓, the form under it. */
export function ApprovableRow({
  task,
  busy,
  run,
  links = false,
}: {
  task: TaskView
  busy: string | null
  run: Run
  /** The `openRows` switch (#205): each row opens its page. */
  links?: boolean
}) {
  const r = useRejecting()
  return (
    <div className="grid gap-2">
      <TaskRow
        name={task.title}
        state="pending"
        points={task.score}
        meta={task.completedBy ? `${cs.work.doneBy} ${task.completedBy.name}` : undefined}
        action={
          r.open ? undefined : (
            <ApproveIcons
              task={task}
              busy={busy}
              run={run}
              onReject={r.start}
              rejectRef={r.rejectRef}
            />
          )
        }
        link={links ? taskLink(task.id) : undefined}
      />
      {r.open && <RejectForm taskId={task.id} busy={busy} run={run} onClose={r.close} />}
    </div>
  )
}

/** The task page's ✓ / ✕ (#206): only for a parent, only on done work not yet confirmed. */
export function ApprovePanel({ task, me }: { task: TaskView; me: Me }) {
  const { busy, run } = useTaskAction()
  const r = useRejecting()
  if (!canApprove(task, me)) return null
  return r.open ? (
    <RejectForm taskId={task.id} busy={busy} run={run} onClose={r.close} />
  ) : (
    <ApproveWide task={task} busy={busy} run={run} onReject={r.start} rejectRef={r.rejectRef} />
  )
}
