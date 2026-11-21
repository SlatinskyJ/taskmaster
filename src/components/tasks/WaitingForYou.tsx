import { Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { approveOutcome, approveTemplate } from '~/components/templates/actions'
import { Button, buttonVariants } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { templateDetail } from '~/lib/templateText'
import type { TaskView } from '~/server/tasks/functions'
import type { TemplateView } from '~/server/templates/functions'
import { callBid } from './bidCalls'
import type { Me } from './taskView'
import { bidButtons, myBid, taskChipState, toastFor, waitingMeta } from './taskView'
import { TaskRow } from './TaskRow'
import { useTaskAction } from './useTaskAction'

/**
 * "Čeká na tebe" (UI doc §6 [call]: always at the top of Domů): new task offers and new
 * recurring templates waiting for this person's approval (TApprove, spec §5.1, §5.2 path 1).
 * A template row shows its whole schedule, deadline and who agreed, so nobody agrees to a score
 * without seeing what it is for. Renders nothing when nothing waits.
 * A task row stays short and the task page explains (#34): without my bid, "Souhlasím" and a
 * link "Jiná cena" to the page; with my bid only "Otevřít", because picking between "Beru" and
 * "Souhlasím" needs both hints, which a row has no room for.
 */
export function WaitingForYou({
  items,
  templates = [],
  me,
}: {
  items: readonly TaskView[]
  templates?: readonly TemplateView[]
  me: Me
}) {
  const router = useRouter()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const action = useTaskAction()
  const anyBusy = busyKey !== null || action.busy !== null
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
        disabled={anyBusy}
        aria-busy={busyKey === key}
        onClick={() => {
          void approve(key, call)
        }}
      >
        {busyKey === key ? cs.tasks.approving : cs.tasks.approve}
      </Button>
    )
  }

  function pageLink(task: TaskView, label: string) {
    return (
      <Link
        to="/ukol/$taskId"
        params={{ taskId: String(task.id) }}
        className={buttonVariants({ variant: 'ghost' })}
      >
        {label}
      </Link>
    )
  }

  function taskActions(task: TaskView) {
    const approve = bidButtons(task, me).find((b) => b.key === 'approve')
    if (myBid(task, me) !== null || !approve) return pageLink(task, cs.bids.open)
    const key = `task-${String(task.id)}`
    return (
      <div className="flex flex-col items-stretch gap-1.5">
        <Button
          variant="ok"
          disabled={anyBusy}
          aria-busy={action.busy === key}
          onClick={() => {
            void action.run(
              key,
              () => callBid(approve),
              (r) => toastFor(approve.action, r.status, me),
            )
          }}
        >
          {action.busy === key ? cs.tasks.approving : approve.label}
        </Button>
        {pageLink(task, cs.bids.otherPriceShort)}
      </div>
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
              state={taskChipState(task)}
              points={task.score}
              meta={waitingMeta(task, me)}
              action={taskActions(task)}
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
