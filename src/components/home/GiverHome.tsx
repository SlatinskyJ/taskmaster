import { TakersPoints } from '~/components/points/TakersPoints'
import { BidsToAnswer } from '~/components/tasks/BidsToAnswer'
import { waitingOnTakers, type Me } from '~/components/tasks/taskView'
import { ToApprove } from '~/components/tasks/ToApprove'
import type { PointsOverview } from '~/server/points/functions'
import type { TaskView } from '~/server/tasks/functions'
import { WaitingOnTakers } from './WaitingOnTakers'

/**
 * A parent's Domů under "Čeká na tebe" (UI doc §7.2 GHome, mockup GHome): the boys' points
 * this week, completions to approve, bids to answer, then offers still waiting for the boys.
 * The meeting card comes with #44, the week picker with #42.
 */
export function GiverHome({
  points,
  tasks,
  toApprove,
  bids,
  me,
  approveOnTop = false,
}: {
  points: PointsOverview
  tasks: readonly TaskView[]
  toApprove: readonly TaskView[]
  bids: readonly TaskView[]
  me: Me
  /** Ke schválení already sits at the top of Domů (#206), so not here again. */
  approveOnTop?: boolean
}) {
  return (
    <>
      <TakersPoints points={points} />
      {!approveOnTop && <ToApprove items={toApprove} />}
      <BidsToAnswer items={bids} />
      <WaitingOnTakers items={waitingOnTakers(tasks, me)} me={me} />
    </>
  )
}
