import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { EmptyState } from '~/components/EmptyState'
import { Screen } from '~/components/shell/Screen'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { TaskGroups } from '~/components/tasks/TaskGroups'
import { instanceMeta, waitingText } from '~/components/tasks/taskView'
import { TemplateRow } from '~/components/templates/TemplateRow'
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
import { completeTaskFn, listTasksFn, releaseTaskFn, type TaskView } from '~/server/tasks/functions'
import { listTemplatesFn } from '~/server/templates/functions'
import { createInstanceFn } from '~/server/instances/functions'

// Úkoly: all one-time tasks grouped by state, active first (UI doc §7.2 GTasks, #41), givers only. A giver can release a
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
  const { user, features } = Route.useRouteContext()
  const { list, templates } = Route.useLoaderData()
  const { busy, run } = useTaskAction()
  // "Hotovo bez bodů" can't be undone, so it asks first (UI doc §5).
  const [closing, setClosing] = useState<TaskView | null>(null)

  function meta(t: TaskView) {
    if (t.status === 'proposed') {
      if (t.lowest) return undefined
      return waitingText(t, user) ?? cs.tasks.waitingForTaker
    }
    if (t.status === 'reserved' && t.reservedBy) return `${cs.work.reservedBy} ${t.reservedBy.name}`
    if (t.completedBy) return `${cs.work.doneBy} ${t.completedBy.name}`
    return instanceMeta(t, new Date())
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
    // A reopened round with bids waits for the parent like a Návrh does (#212).
    if (t.status === 'open' && t.rebidding && t.bids.length > 0) {
      return (
        <Link
          to="/ukol/$taskId"
          params={{ taskId: String(t.id) }}
          className={buttonVariants({ variant: 'ghost' })}
        >
          {cs.bids.answer}
        </Link>
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
      <section
        className="grid gap-2"
        aria-labelledby={features.recurring ? 'one-time-label' : undefined}
      >
        {features.recurring && (
          <SectionLabel id="one-time-label">{cs.templates.itemsSection}</SectionLabel>
        )}
        {list.length === 0 ? (
          <EmptyState>{cs.tasks.empty}</EmptyState>
        ) : (
          <TaskGroups
            list={list}
            meta={meta}
            action={action}
            linked={(t) => features.reopenBidding && t.status === 'open' && t.origin === 'one_time'}
          />
        )}
      </section>
      {features.recurring && (
        <section className="grid gap-2" aria-labelledby="templates-label">
          <SectionLabel id="templates-label">{cs.templates.section}</SectionLabel>
          {templates.length === 0 ? (
            <EmptyState>{cs.templates.empty}</EmptyState>
          ) : (
            <ul className="grid gap-2">
              {templates.map((t) => (
                <li key={t.id}>
                  <TemplateRow
                    template={t}
                    busy={busy !== null}
                    onNow={() => {
                      void run(
                        `now-${String(t.id)}`,
                        () => createInstanceFn({ data: { templateId: t.id } }),
                        () => cs.instances.toast.created,
                      )
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
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
