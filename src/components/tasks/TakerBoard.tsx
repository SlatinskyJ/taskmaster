import { EmptyState } from '~/components/EmptyState'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { reserveTaskFn, type TaskView } from '~/server/tasks/functions'
import { canWorkOn } from './taskView'
import { TaskRow } from './TaskRow'
import { useTaskAction } from './useTaskAction'
import { WorkButtons } from './WorkButtons'

/**
 * A taker's work on Domů (UI doc §7.1, until #40 builds the full home): "Moje" (reserved by me,
 * or done and waiting for approval) and "Volné" (open, Rezervovat). Marking an open task done
 * without reserving it is allowed by the server (spec §5.5) and gets its button with #40.
 * On a reserved "Moje" row, ↶ Uvolnit is an icon button so the name and chip read in full at
 * 360 px; Hotovo, the main action, keeps its label (mockup Main, #148). See WorkButtons.
 */
export function TakerBoard({ items, me }: { items: readonly TaskView[]; me: number }) {
  const { busy, run } = useTaskAction()
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
                    action={<WorkButtons task={t} busy={busy} run={run} />}
                  />
                ) : (
                  <TaskRow name={t.title} state="pending" points={t.score} />
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
                  name={t.title}
                  state="open"
                  points={t.score}
                  action={
                    <Button
                      variant="ghost"
                      disabled={busy !== null}
                      aria-busy={busy === `reserve-${String(t.id)}`}
                      onClick={() => {
                        void run(
                          `reserve-${String(t.id)}`,
                          () => reserveTaskFn({ data: { taskId: t.id } }),
                          () => cs.work.toast.reserved,
                        )
                      }}
                    >
                      {cs.work.reserve}
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
