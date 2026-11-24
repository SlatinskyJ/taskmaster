import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import type { TaskView } from '~/server/tasks/functions'
import { callBid } from './bidCalls'
import type { Me } from './taskView'
import { reopenButton, toastFor } from './taskView'
import { useTaskAction } from './useTaskAction'

/**
 * "Vyjednat novou cenu" on a free one-time task (#212, spec §5.2): starts a new round, the agreed
 * score stays until a new one is agreed. One tap, its outcome in the hint under it (no dialog).
 * Renders nothing when the person may not reopen, or the switch is off.
 */
export function ReopenBidding({ task, me, on }: { task: TaskView; me: Me; on: boolean }) {
  const { busy, run } = useTaskAction()
  const button = reopenButton(task, me, on)
  if (!button) return null
  return (
    <div className="grid gap-1">
      <Button
        variant={button.variant}
        disabled={busy !== null}
        aria-busy={busy === button.key}
        className="w-full"
        onClick={() => {
          void run(
            button.key,
            () => callBid(button),
            (r) => toastFor(button, r.status, me, false),
          )
        }}
      >
        {busy === button.key ? cs.tasks.approving : button.label}
      </Button>
      <p className="text-meta text-muted">{button.hint}</p>
    </div>
  )
}
