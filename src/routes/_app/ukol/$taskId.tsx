import { createFileRoute, notFound } from '@tanstack/react-router'
import { Screen } from '~/components/shell/Screen'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { BidPanel } from '~/components/tasks/BidPanel'
import { BidThread } from '~/components/tasks/BidThread'
import { StateChip } from '~/components/tasks/StateChip'
import { TaskWorkPanel } from '~/components/tasks/WorkButtons'
import { detailMeta, taskChipState, waitingText } from '~/components/tasks/taskView'
import { Card } from '~/components/ui/card'
import { parseIdParam } from '~/lib/idParam'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { getTaskDetailFn } from '~/server/tasks/functions'

// One task's page (#34): TTask for a brother, GBid for a parent (UI doc §7). The state, the
// whole bid thread, and what this person can do now: bid, or Hotovo and Uvolnit for the brother
// who has the task (#150). Reserve stays on Domů.
export const Route = createFileRoute('/_app/ukol/$taskId')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/ukol/$taskId')
  },
  loader: async ({ params }) => {
    const taskId = parseIdParam(params.taskId)
    // TanStack Router's notFound() is thrown by design; it is not an Error.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (taskId === null) throw notFound()
    const detail = await getTaskDetailFn({ data: { taskId } })
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (!detail) throw notFound()
    return detail
  },
  component: TaskPage,
})

function TaskPage() {
  const { user } = Route.useRouteContext()
  const { task, thread } = Route.useLoaderData()
  const me = { id: user.id, role: user.role }
  const meta = detailMeta(task, me)
  const waiting = waitingText(task, me)
  return (
    <Screen title={task.title} user={user} back="/">
      <Card className="grid gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StateChip state={taskChipState(task)} />
          <span className="num text-title font-bold">{task.score}</span>
          {meta && <span className="text-meta text-muted">{meta}</span>}
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
      </Card>
      <TaskWorkPanel task={task} me={me} />
      <section className="grid gap-2" aria-labelledby="thread-label">
        <SectionLabel id="thread-label">{cs.bids.thread}</SectionLabel>
        <BidThread entries={thread} me={user.id} />
      </section>
      <BidPanel key={`${String(task.score)}-${String(thread.length)}`} task={task} me={me} />
    </Screen>
  )
}
