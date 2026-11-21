import { Check, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { cs } from '~/lib/strings'
import { REASON_MAX } from '~/lib/taskLimits'
import { approveTaskFn, rejectTaskFn, type TaskView } from '~/server/tasks/functions'
import { TaskRow } from './TaskRow'
import { useTaskAction } from './useTaskAction'

/**
 * "Ke schválení" on a giver's Domů (spec §5.5, until #41 builds the full home): completions
 * waiting for a giver. ✓ Schválit counts the points; ✕ Zamítnout opens a reason field (optional)
 * and sends the task back to its taker. Icon buttons (mockup GHome) leave room for the name,
 * chip and who did it at 360 px (#131). Renders nothing when nothing waits.
 */
export function ToApprove({ items }: { items: readonly TaskView[] }) {
  const { busy, run } = useTaskAction()
  const [rejecting, setRejecting] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  // Zamítnout swaps the buttons for the form; Zpět brings focus back to that row's Zamítnout.
  const rejectButtons = useRef(new Map<number, HTMLButtonElement>())
  function closeForm(id: number) {
    setRejecting(null)
    requestAnimationFrame(() => {
      rejectButtons.current.get(id)?.focus()
    })
  }
  if (items.length === 0) return null

  return (
    <section className="grid gap-2" aria-labelledby="approve-label">
      <SectionLabel id="approve-label">
        {cs.work.toApprove} ({items.length})
      </SectionLabel>
      <ul className="grid gap-2">
        {items.map((t) => (
          <li key={t.id} className="grid gap-2">
            <TaskRow
              name={t.title}
              state="pending"
              points={t.score}
              meta={t.completedBy ? `${cs.work.doneBy} ${t.completedBy.name}` : undefined}
              action={
                rejecting === t.id ? undefined : (
                  <div className="flex gap-1.5">
                    <Button
                      ref={(el) => {
                        if (el) rejectButtons.current.set(t.id, el)
                        else rejectButtons.current.delete(t.id)
                      }}
                      variant="no"
                      size="icon"
                      aria-label={cs.work.reject}
                      disabled={busy !== null}
                      onClick={() => {
                        setRejecting(t.id)
                        setReason('')
                      }}
                    >
                      <X aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ok"
                      size="icon"
                      aria-label={cs.work.approve}
                      disabled={busy !== null}
                      aria-busy={busy === `approve-${String(t.id)}`}
                      onClick={(e) => {
                        void run(
                          `approve-${String(t.id)}`,
                          () => approveTaskFn({ data: { taskId: t.id } }),
                          () => cs.work.toast.approved,
                          { confetti: e.currentTarget, float: t.score },
                        )
                      }}
                    >
                      <Check aria-hidden="true" />
                    </Button>
                  </div>
                )
              }
            />
            {rejecting === t.id && (
              <form
                className="grid gap-2 rounded-card bg-surface p-3 shadow-sticker"
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(
                    `reject-${String(t.id)}`,
                    () =>
                      rejectTaskFn({
                        data: { taskId: t.id, reason: reason.trim() || undefined },
                      }),
                    () => cs.work.toast.rejected,
                  ).then((ok) => {
                    if (ok) setRejecting(null)
                  })
                }}
              >
                <label className="grid gap-1.5">
                  <span className="text-meta font-bold text-muted">{cs.work.rejectReason}</span>
                  <Input
                    name="reason"
                    autoFocus
                    maxLength={REASON_MAX}
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value)
                    }}
                  />
                </label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex-1"
                    onClick={() => {
                      closeForm(t.id)
                    }}
                  >
                    {cs.work.back}
                  </Button>
                  <Button type="submit" variant="no" className="flex-1" disabled={busy !== null}>
                    {cs.work.reject}
                  </Button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
