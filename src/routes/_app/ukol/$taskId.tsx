import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { DescriptionBlock } from '~/components/descriptions/DescriptionBlock'
import { canEditDescription } from '~/components/descriptions/descriptionCalls'
import { DisputeControl } from '~/components/disputes/DisputeControl'
import { taskDisputes } from '~/components/disputes/disputeProps'
import { Screen } from '~/components/shell/Screen'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { ApprovePanel } from '~/components/tasks/ApproveControls'
import { BidPanel } from '~/components/tasks/BidPanel'
import { BidThread } from '~/components/tasks/BidThread'
import { ReopenBidding } from '~/components/tasks/ReopenBidding'
import { CancelTask } from '~/components/tasks/CancelTask'
import { ScoreChangePanel } from '~/components/tasks/ScoreChangePanel'
import { StateChip } from '~/components/tasks/StateChip'
import { TaskHistory } from '~/components/tasks/TaskHistory'
import { TaskWorkPanel } from '~/components/tasks/WorkButtons'
import {
  detailMeta,
  instanceMeta,
  roundLines,
  taskChipState,
  waitingText,
} from '~/components/tasks/taskView'
import { buttonVariants } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { parseIdParam } from '~/lib/idParam'
import { guardDisputeReader } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { getItemMarkFn } from '~/server/disputes/functions'
import type { DisputeMark } from '~/server/disputes/functions'
import { getTaskDetailFn } from '~/server/tasks/functions'

// One task's page (#34): TTask for a brother, GBid / GTask for a parent (UI doc §7). The state,
// what this person can do now (bid; Hotovo and Uvolnit for the brother who has the task, #150;
// a new price, a giver's cancel, #36; Rezervovat on a free task, #195), the bid thread and the
// task's history. A chore's copy links to its chore (#205).
export const Route = createFileRoute('/_app/ukol/$taskId')({
  beforeLoad: ({ context }) => {
    // The admin reads it while disputes is on (#222: Sporné on Správa); never acts on it.
    guardDisputeReader(context.user.role, '/ukol/$taskId', context.features.disputes)
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
    // Not for the admin: Rozporovat is a party's action, and marks are giver/taker only.
    const items =
      context.features.disputes && context.user.role !== 'admin'
        ? taskDisputes(detail.task, false)
        : []
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
  const { task, thread, history, disputeMarks, descriptionChange } = Route.useLoaderData()
  const me = { id: user.id, role: user.role }
  const meta = detailMeta(task, me)
  const due = instanceMeta(task, new Date())
  const waiting = waitingText(task, me)
  const oneTime = task.origin === 'one_time'
  return (
    <Screen title={task.title} user={user} back="history">
      <Card className="grid gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StateChip state={taskChipState(task)} />
          <span className="num text-title font-bold">{task.score}</span>
          {meta && <span className="text-meta text-muted">{meta}</span>}
          {due && <span className="text-meta text-muted">{due}</span>}
        </div>
        {roundLines(task).map((line) => (
          <p key={line} className="text-meta text-muted">
            {line}
          </p>
        ))}
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
        {features.descriptions && (
          <DescriptionBlock
            text={task.description}
            change={descriptionChange}
            target={{ kind: 'task', id: task.id }}
            canEdit={canEditDescription(
              { kind: 'task', status: task.status, origin: task.origin },
              me,
            )}
            proposed={task.status === 'proposed'}
            me={me}
          />
        )}
        {features.openRows && task.templateId !== null && (
          <Link
            to="/sablona/$templateId"
            params={{ templateId: String(task.templateId) }}
            className={buttonVariants({ variant: 'ghost' })}
          >
            {cs.tasks.chorePageLink}
          </Link>
        )}
        {features.disputes &&
          user.role !== 'admin' &&
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
      {oneTime && (
        <ScoreChangePanel
          key={`price-${String(task.score)}`}
          task={task}
          me={me}
          rebid={features.reopenBidding}
        />
      )}
      {oneTime && <ReopenBidding task={task} me={me} on={features.reopenBidding} />}
      <CancelTask task={task} me={me} />
      {/* ...and nothing to negotiate, so no empty thread heading. */}
      {oneTime && (
        <section className="grid gap-2" aria-labelledby="thread-label">
          <SectionLabel id="thread-label">{cs.bids.thread}</SectionLabel>
          <BidThread
            entries={thread}
            me={user.id}
            empty={task.rebidding ? cs.rebid.noEntries : undefined}
          />
        </section>
      )}
      <BidPanel
        key={`${String(task.score)}-${String(task.rebidding?.offer)}-${String(thread.length)}`}
        task={task}
        me={me}
        refusals={features.bidRefusals}
      />
      <TaskHistory entries={history} meId={user.id} />
    </Screen>
  )
}
