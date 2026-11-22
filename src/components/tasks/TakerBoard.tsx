import { Bookmark } from 'lucide-react'
import { EmptyState } from '~/components/EmptyState'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { reserveTaskFn, type TaskView } from '~/server/tasks/functions'
import { canWorkOn, instanceMeta } from './taskView'
import { TaskRow } from './TaskRow'
import { useTaskAction } from './useTaskAction'
import { DoneButton, WorkButtons } from './WorkButtons'

/**
 * A taker's work on Domů (UI doc §7.1): "Moje" (reserved by me, or done and waiting for
 * approval) and "Volné" (open). An open task can be marked done without reserving it (spec
 * §5.4, #40). On both rows the main action, Hotovo, keeps its label and the other one is a
 * 44 px icon button (↶ Uvolnit on "Moje", Rezervovat on "Volné"), so a long name and the chip
 * read in full at 360 px (mockup Main, #148). The task page keeps both labelled.
 */
export function TakerBoard({ items, me }: { items: readonly TaskView[]; me: number }) {
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
                  meta={instanceMeta(t, now)}
                  action={
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={cs.work.reserve}
                        title={cs.work.reserve}
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
                        <Bookmark aria-hidden="true" />
                      </Button>
                      <DoneButton task={t} busy={busy} run={run} />
                    </div>
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
