import { Undo2 } from 'lucide-react'
import { EmptyState } from '~/components/EmptyState'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import {
  completeTaskFn,
  releaseTaskFn,
  reserveTaskFn,
  type TaskView,
} from '~/server/tasks/functions'
import { TaskRow } from './TaskRow'
import { useTaskAction } from './useTaskAction'

/**
 * A taker's work on Domů (UI doc §7.1, until #40 builds the full home): "Moje" (reserved by me,
 * or done and waiting for approval) and "Volné" (open, Rezervovat). Marking an open task done
 * without reserving it is allowed by the server (spec §5.5) and gets its button with #40.
 * On a reserved "Moje" row, ↶ Uvolnit is an icon button so the name and chip read in full at
 * 360 px; Hotovo, the main action, keeps its label (mockup Main, #148).
 */
export function TakerBoard({ items, me }: { items: readonly TaskView[]; me: number }) {
  const { busy, run } = useTaskAction()
  const mine = items.filter(
    (t) => t.reservedBy?.id === me || (t.status === 'done_unconfirmed' && t.earnerId === me),
  )
  const free = items.filter((t) => t.status === 'open')

  const done = (t: TaskView, el: Element) =>
    run(
      `done-${String(t.id)}`,
      () => completeTaskFn({ data: { taskId: t.id } }),
      (r) => (r.status === 'confirmed' ? cs.work.toast.done : cs.work.toast.pending),
      { confetti: el },
    )

  return (
    <>
      {mine.length > 0 && (
        <section className="grid gap-2" aria-labelledby="mine-label">
          <SectionLabel id="mine-label">{cs.work.mine}</SectionLabel>
          <ul className="grid gap-2">
            {mine.map((t) =>
              t.status === 'done_unconfirmed' ? (
                <li key={t.id}>
                  <TaskRow name={t.title} state="pending" points={t.score} />
                </li>
              ) : (
                <li key={t.id}>
                  <TaskRow
                    name={t.title}
                    state="reserved"
                    points={t.score}
                    action={
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={cs.work.release}
                          disabled={busy !== null}
                          aria-busy={busy === `release-${String(t.id)}`}
                          onClick={() => {
                            void run(
                              `release-${String(t.id)}`,
                              () => releaseTaskFn({ data: { taskId: t.id } }),
                              () => cs.work.toast.released,
                            )
                          }}
                        >
                          <Undo2 aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ok"
                          disabled={busy !== null}
                          aria-busy={busy === `done-${String(t.id)}`}
                          onClick={(e) => {
                            void done(t, e.currentTarget)
                          }}
                        >
                          {cs.work.done}
                        </Button>
                      </div>
                    }
                  />
                </li>
              ),
            )}
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
