import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { approveOutcome, approveTemplate } from '~/components/templates/actions'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { templateDetail } from '~/lib/templateText'
import { approveTaskOfferFn, type TaskView } from '~/server/tasks/functions'
import type { TemplateView } from '~/server/templates/functions'
import { TaskRow } from './TaskRow'

/**
 * "Čeká na tebe" (UI doc §6 [call]: always at the top of Domů): new task offers and new
 * recurring templates waiting for this person's approval (TApprove, spec §5.1, §5.2 path 1).
 * A template row shows its whole schedule, deadline and who agreed, so nobody agrees to a score
 * without seeing what it is for. Renders nothing when nothing waits.
 * Counter-offers ("Chci jinou cenu") come with bidding, #34.
 */
export function WaitingForYou({
  items,
  templates = [],
}: {
  items: readonly TaskView[]
  templates?: readonly TemplateView[]
}) {
  const router = useRouter()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const count = items.length + templates.length
  if (count === 0) return null

  async function approve(
    key: string,
    call: () => Promise<{ ok: true } | { ok: false; error: string }>,
  ) {
    setBusyKey(key)
    try {
      const outcome = approveOutcome(await call().catch(() => 'threw' as const))
      if (outcome.toast === 'success') toast.success(outcome.message)
      else toast.error(outcome.message)
      await router.invalidate()
    } finally {
      setBusyKey(null)
    }
  }

  function approveButton(
    key: string,
    call: () => Promise<{ ok: true } | { ok: false; error: string }>,
  ) {
    return (
      <Button
        variant="ok"
        disabled={busyKey !== null}
        aria-busy={busyKey === key}
        onClick={() => {
          void approve(key, call)
        }}
      >
        {busyKey === key ? cs.tasks.approving : cs.tasks.approve}
      </Button>
    )
  }

  return (
    <section className="grid gap-2" aria-labelledby="waiting-label">
      <SectionLabel id="waiting-label">
        {cs.home.waiting} ({count})
      </SectionLabel>
      <ul className="grid gap-2">
        {items.map((task) => (
          <li key={`task-${String(task.id)}`}>
            <TaskRow
              name={task.title}
              state="proposed"
              points={task.score}
              meta={`${cs.tasks.offeredBy} ${task.createdByName}`}
              action={approveButton(`task-${String(task.id)}`, () =>
                approveTaskOfferFn({ data: { taskId: task.id, score: task.score } }),
              )}
            />
          </li>
        ))}
        {templates.map((t) => (
          <li key={`template-${String(t.id)}`}>
            <TaskRow
              name={t.title}
              state="proposed"
              points={t.score}
              meta={cs.templates.recurringMeta}
              detail={templateDetail(t)}
              action={approveButton(`template-${String(t.id)}`, () => approveTemplate(t))}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
