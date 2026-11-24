import { createFileRoute, notFound } from '@tanstack/react-router'
import { DisputeControl } from '~/components/disputes/DisputeControl'
import { taskDisputes } from '~/components/disputes/disputeProps'
import { Screen } from '~/components/shell/Screen'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { ApprovePanel } from '~/components/tasks/ApproveControls'
import { BidPanel } from '~/components/tasks/BidPanel'
import { BidThread } from '~/components/tasks/BidThread'
import { CancelTask } from '~/components/tasks/CancelTask'
import { ScoreChangePanel } from '~/components/tasks/ScoreChangePanel'
import { StateChip } from '~/components/tasks/StateChip'
import { TaskHistory } from '~/components/tasks/TaskHistory'
import { TaskWorkPanel } from '~/components/tasks/WorkButtons'
import { detailMeta, instanceMeta, taskChipState, waitingText } from '~/components/tasks/taskView'
import { Card } from '~/components/ui/card'
import { parseIdParam } from '~/lib/idParam'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { getItemMarkFn } from '~/server/disputes/functions'
import type { DisputeMark } from '~/server/disputes/functions'
import { getTaskDetailFn } from '~/server/tasks/functions'

// One task's page (#34): TTask for a brother, GBid / GTask for a parent (UI doc §7). The state,
// what this person can do now (bid; Hotovo and Uvolnit for the brother who has the task, #150;
// a new price, a giver's cancel, #36), the bid thread and the task's history. Reserve stays
// on Domů.
export const Route = createFileRoute('/_app/ukol/$taskId')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/ukol/$taskId')
  },
  loader: async ({ params, context }) => {
    const taskId = parseIdParam(params.taskId)
    // TanStack Router's notFound() is thrown by design; it is not an Error.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (taskId === null) throw notFound()
    const detail = await getTaskDetailFn({ data: { taskId } })
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (!detail) throw notFound()
    // Rozporovat (#46): the marks of the score and the completion, only with the switch on.
    const items = context.features.disputes ? taskDisputes(detail.task, false) : []
    // Keyed by kind (one score and one completion per task), so a mark can't land on the
    // other line.
    const marks = await Promise.all(
      items.map(async (d) => {
        const m = await getItemMarkFn({ data: d.item })
        return [d.item.kind, m && 'error' in m ? null : m] as const
      }),
    )
    return {
      ...detail,
      disputeMarks: Object.fromEntries(marks) as Partial<Record<string, DisputeMark | null>>,
    }
  },
  component: TaskPage,
})

function TaskPage() {
  const { user, features } = Route.useRouteContext()
  const { task, thread, history, disputeMarks } = Route.useLoaderData()
  const me = { id: user.id, role: user.role }
  const meta = detailMeta(task, me)
  const due = instanceMeta(task, new Date())
  const waiting = waitingText(task, me)
  const oneTime = task.origin === 'one_time'
  return (
    <Screen title={task.title} user={user} back="/">
      <Card className="grid gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StateChip state={taskChipState(task)} />
          <span className="num text-title font-bold">{task.score}</span>
          {meta && <span className="text-meta text-muted">{meta}</span>}
          {due && <span className="text-meta text-muted">{due}</span>}
        </div>
        {task.status === 'proposed' && (
          <p className="text-meta text-muted">
            {cs.bids.agreed}: {task.approvedBy.map((name) => `${name} ✓`).join(', ')}
            {waiting && (
              <>
                <br />
                {waiting}
              </>
            )}
          </p>
        )}
        {features.disputes &&
          taskDisputes(task, user.role === 'giver').map((d) => (
            <DisputeControl
              key={d.item.kind}
              {...d}
              mark={disputeMarks[d.item.kind] ?? null}
              lead
            />
          ))}
      </Card>
      {/* ✓ / ✕ for done work waiting for a parent (#206). */}
      {features.approveAnywhere && <ApprovePanel task={task} me={me} />}
      <TaskWorkPanel task={task} me={me} />
      {/* An instance's score is fixed when it is made (spec §4, #38): no price change. */}
      {oneTime && <ScoreChangePanel key={`price-${String(task.score)}`} task={task} me={me} />}
      <CancelTask task={task} me={me} />
      {/* ...and nothing to negotiate, so no empty thread heading. */}
      {oneTime && (
        <section className="grid gap-2" aria-labelledby="thread-label">
          <SectionLabel id="thread-label">{cs.bids.thread}</SectionLabel>
          <BidThread entries={thread} me={user.id} />
        </section>
      )}
      <BidPanel key={`${String(task.score)}-${String(thread.length)}`} task={task} me={me} />
      <TaskHistory entries={history} meId={user.id} />
    </Screen>
  )
}
