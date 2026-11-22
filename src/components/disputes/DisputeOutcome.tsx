import { StateChip } from '~/components/tasks/StateChip'
import { cs } from '~/lib/strings'
import { cn } from '~/lib/utils'
import type { DisputeMark } from '~/server/disputes/functions'

/**
 * An open dispute's chip, or the closed one's outcome with the admin's note (spec §5.11).
 * `ownLine`: the note goes under the line (a line with a lead has no room beside it at 360 px).
 */
export function DisputeOutcome({
  mark,
  ownLine = false,
}: {
  mark: DisputeMark
  ownLine?: boolean
}) {
  if (mark.status === 'open') {
    return <StateChip state="disputed" label={cs.disputes.waiting} className="max-w-full" />
  }
  return (
    <span
      className={cn(
        'min-w-0 flex-1 text-meta font-bold break-words text-state-disputed-text',
        ownLine && 'order-last basis-full',
      )}
    >
      {mark.status === 'dismissed' ? cs.disputes.kept(mark.note) : cs.disputes.fixed(mark.note)}
    </span>
  )
}
