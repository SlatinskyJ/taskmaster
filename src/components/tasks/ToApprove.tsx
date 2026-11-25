import { SectionLabel } from '~/components/shell/SectionLabel'
import { cs } from '~/lib/strings'
import type { TaskView } from '~/server/tasks/functions'
import { ApprovableRow } from './ApproveControls'
import { useTaskAction } from './useTaskAction'

/**
 * "Ke schválení" on a giver's Domů and on Schůzka (spec §5.5): completions waiting for a giver.
 * ✓ Schválit counts the points; ✕ Zamítnout opens a reason field (optional) and sends the task
 * back to its taker (ApprovableRow). Renders nothing when nothing waits.
 */
export function ToApprove({ items }: { items: readonly TaskView[] }) {
  const { busy, run } = useTaskAction()
  if (items.length === 0) return null

  return (
    <section className="grid gap-2" aria-labelledby="approve-label">
      <SectionLabel id="approve-label">
        {cs.work.toApprove} ({items.length})
      </SectionLabel>
      <ul className="grid gap-2">
        {items.map((t) => (
          <li key={t.id}>
            <ApprovableRow task={t} busy={busy} run={run} />
          </li>
        ))}
      </ul>
    </section>
  )
}
