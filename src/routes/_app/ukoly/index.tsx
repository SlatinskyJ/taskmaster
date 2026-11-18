import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { EmptyState } from '~/components/EmptyState'
import { Screen } from '~/components/shell/Screen'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { lowestText, taskChipState } from '~/components/tasks/taskView'
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
import { cs } from '~/lib/strings'
import { templateDetail } from '~/lib/templateText'
import { completeTaskFn, listTasksFn, releaseTaskFn, type TaskView } from '~/server/tasks/functions'
import { listTemplatesFn, type TemplateView } from '~/server/templates/functions'

// Úkoly: all one-time tasks by state, givers only (UI doc §7.2 GTasks). A giver can release a
// reservation or mark an open task done themselves (spec §5.4–§5.5). Recurring templates are
// listed below the one-time tasks, so rows that need action stay on top (#37).
export const Route = createFileRoute('/_app/ukoly/')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/ukoly')
  },
  loader: async () => ({ list: await listTasksFn(), templates: await listTemplatesFn() }),
  component: Tasks,
})

function Tasks() {
  const { user } = Route.useRouteContext()
  const { list, templates } = Route.useLoaderData()
  const { busy, run } = useTaskAction()
  // "Hotovo bez bodů" can't be undone, so it asks first (UI doc §5).
  const [closing, setClosing] = useState<TaskView | null>(null)

  function meta(t: TaskView) {
    if (t.status === 'proposed') return t.lowest ? undefined : cs.tasks.waitingForTaker
    if (t.status === 'reserved' && t.reservedBy) return `${cs.work.reservedBy} ${t.reservedBy.name}`
    if (t.completedBy) return `${cs.work.doneBy} ${t.completedBy.name}`
    return undefined
  }

  function action(t: TaskView) {
    if (t.status === 'proposed') {
      // The way into the negotiation (#34): a 44 px button, like Domů's.
      return (
        <Link
          to="/ukol/$taskId"
          params={{ taskId: String(t.id) }}
          className={buttonVariants({ variant: 'ghost' })}
        >
          {t.bids.length > 0 ? cs.bids.answer : cs.bids.open}
        </Link>
      )
    }
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
      <section className="grid gap-2" aria-labelledby="one-time-label">
        <SectionLabel id="one-time-label">{cs.templates.oneTimeSection}</SectionLabel>
        {list.length === 0 ? (
          <EmptyState>{cs.tasks.empty}</EmptyState>
        ) : (
          <ul className="grid gap-2">
            {list.map((t) => (
              <li key={t.id}>
                <TaskRow
                  name={t.title}
                  state={taskChipState(t)}
                  points={t.score}
                  meta={meta(t)}
                  detail={t.lowest ? lowestText(t.lowest) : undefined}
                  action={action(t)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid gap-2" aria-labelledby="templates-label">
        <SectionLabel id="templates-label">{cs.templates.section}</SectionLabel>
        {templates.length === 0 ? (
          <EmptyState>{cs.templates.empty}</EmptyState>
        ) : (
          <ul className="grid gap-2">
            {templates.map((t) => (
              <li key={t.id}>
                <TemplateRow template={t} />
              </li>
            ))}
          </ul>
        )}
      </section>
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

/** A template on Úkoly: proposed ones wait for agreement, active ones "Platí" (green). */
function TemplateRow({ template: t }: { template: TemplateView }) {
  const active = t.status === 'active'
  return (
    <TaskRow
      name={t.title}
      state={active ? 'confirmed' : 'proposed'}
      stateLabel={active ? cs.templates.activeChip : undefined}
      points={t.score}
      meta={active ? cs.templates.recurringMeta : cs.tasks.waitingForTaker}
      detail={templateDetail(t)}
    />
  )
}
