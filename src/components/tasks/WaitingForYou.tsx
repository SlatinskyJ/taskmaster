import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { taskErrorMessage } from '~/lib/taskErrors'
import { approveTaskOfferFn, type TaskView } from '~/server/tasks/functions'
import { TaskRow } from './TaskRow'

/**
 * "Čeká na tebe" (UI doc §6 [call]: always at the top of Domů): new task offers waiting for
 * this person's approval (TApprove, spec §5.2 path 1). Renders nothing when nothing waits.
 * Counter-offers ("Chci jinou cenu") come with bidding, #34.
 */
export function WaitingForYou({ items }: { items: readonly TaskView[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<number | null>(null)
  if (items.length === 0) return null

  async function approve(task: TaskView) {
    setBusyId(task.id)
    try {
      const result = await approveTaskOfferFn({ data: { taskId: task.id, score: task.score } })
      if (result.ok) toast.success(cs.tasks.approved)
      else toast.error(taskErrorMessage(result.error))
      await router.invalidate()
    } catch {
      toast.error(cs.login.failed)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="grid gap-2" aria-labelledby="waiting-label">
      <SectionLabel id="waiting-label">
        {cs.home.waiting} ({items.length})
      </SectionLabel>
      <ul className="grid gap-2">
        {items.map((task) => (
          <li key={task.id}>
            <TaskRow
              name={task.title}
              state="proposed"
              points={task.score}
              meta={`${cs.tasks.offeredBy} ${task.createdByName}`}
              action={
                <Button
                  variant="ok"
                  disabled={busyId !== null}
                  aria-busy={busyId === task.id}
                  onClick={() => {
                    void approve(task)
                  }}
                >
                  {busyId === task.id ? cs.tasks.approving : cs.tasks.approve}
                </Button>
              }
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
