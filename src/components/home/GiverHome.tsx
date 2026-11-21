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
}: {
  points: PointsOverview
  tasks: readonly TaskView[]
  toApprove: readonly TaskView[]
  bids: readonly TaskView[]
  me: Me
}) {
  return (
    <>
      <TakersPoints points={points} />
      <ToApprove items={toApprove} />
      <BidsToAnswer items={bids} />
      <WaitingOnTakers items={waitingOnTakers(tasks, me)} me={me} />
    </>
  )
}
