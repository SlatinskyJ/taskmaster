import { EmptyState } from '~/components/EmptyState'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { cs } from '~/lib/strings'
import type { TaskView } from '~/server/tasks/functions'
import { taskLink } from './rowLink'
import { TaskLink } from './TaskLink'
import { canWorkOn, instanceMeta, taskChipState } from './taskView'
import { TaskRow } from './TaskRow'
import { useTaskAction } from './useTaskAction'
import { DoneButton, ReserveButton, WorkButtons } from './WorkButtons'

/**
 * A taker's work on Domů (UI doc §7.1): "Moje" (reserved by me, or done and waiting for
 * approval) and "Volné" (open). An open task can be marked done without reserving it (spec
 * §5.4, #40). On both rows the main action, Hotovo, keeps its label and the other one is a
 * 44 px icon button (↶ Uvolnit on "Moje", Rezervovat on "Volné"), so a long name and the chip
 * read in full at 360 px (mockup Main, #148). The task page keeps both labelled. With `rebid`
 * (switch `reopenBidding`, #212) a free one-time task's name links to its page, where a brother
 * reopens or answers the bidding.
 */
export function TakerBoard({
  items,
  me,
  rebid = false,
  links = false,
}: {
  items: readonly TaskView[]
  me: number
  rebid?: boolean
  /** The `openRows` switch (#205): each row opens its page (then no separate name link). */
  links?: boolean
}) {
  const { busy, run } = useTaskAction()
  const now = new Date()
  const mine = items.filter(
    (t) => t.reservedBy?.id === me || (t.status === 'done_unconfirmed' && t.earnerId === me),
  )
  const free = items.filter((t) => t.status === 'open')

  return (
    <>
      {mine.length > 0 && (
        <section className="grid gap-2" aria-labelledby="mine-label">
          <SectionLabel id="mine-label">{cs.work.mine}</SectionLabel>
          <ul className="grid gap-2">
            {mine.map((t) => (
              <li key={t.id}>
                {canWorkOn(t, { id: me, role: 'taker' }) ? (
                  <TaskRow
                    name={t.title}
                    state="reserved"
                    points={t.score}
                    meta={instanceMeta(t, now)}
                    action={<WorkButtons task={t} busy={busy} run={run} />}
                    link={links ? taskLink(t.id) : undefined}
                  />
                ) : (
                  <TaskRow
                    name={t.title}
                    state="pending"
                    points={t.score}
                    link={links ? taskLink(t.id) : undefined}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="grid gap-2" aria-labelledby="free-label">
        <SectionLabel id="free-label">{cs.work.free}</SectionLabel>
        {free.length === 0 ? (
          <EmptyState>{cs.tasks.empty}</EmptyState>
        ) : (
          <ul className="grid gap-2">
            {free.map((t) => (
              <li key={t.id}>
                <TaskRow
                  name={
                    !links && rebid && t.origin === 'one_time' ? (
                      <TaskLink id={t.id} title={t.title} />
                    ) : (
                      t.title
                    )
                  }
                  state={taskChipState(t)}
                  points={t.score}
                  meta={instanceMeta(t, now)}
                  action={
                    <div className="flex gap-2">
                      <ReserveButton task={t} busy={busy} run={run} />
                      <DoneButton task={t} busy={busy} run={run} />
                    </div>
                  }
                  link={links ? taskLink(t.id) : undefined}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
