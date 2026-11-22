import { StateChip } from '~/components/tasks/StateChip'
import { cs } from '~/lib/strings'
import type { DisputeMark } from '~/server/disputes/functions'

/** An open dispute's chip, or the closed one's outcome with the admin's note (spec §5.11). */
export function DisputeOutcome({ mark }: { mark: DisputeMark }) {
  if (mark.status === 'open') {
    return <StateChip state="disputed" label={cs.disputes.waiting} className="max-w-full" />
  }
  return (
    <span className="min-w-0 flex-1 text-meta font-bold break-words text-state-disputed-text">
      {mark.status === 'dismissed' ? cs.disputes.kept(mark.note) : cs.disputes.fixed(mark.note)}
    </span>
  )
}
