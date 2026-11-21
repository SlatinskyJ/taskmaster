import { Card } from '~/components/ui/card'
import type { Levels } from '~/domain/settlement'
import { cs } from '~/lib/strings'
import type { PointsOverview } from '~/server/points/functions'
import { PointsBar } from './PointsBar'

/** Mockup Main's line under the bar: how far the certain (confirmed) points are from a level. */
export function missingLine(confirmed: number, levels: Levels): string {
  if (confirmed < levels.lower) return cs.points.missingLower(levels.lower - confirmed)
  if (confirmed < levels.upper) return cs.points.missingUpper(levels.upper - confirmed)
  return cs.points.upperDone
}

/**
 * The taker's own points card at the top of Domů (spec §5.7, §7 sketch, mockup Main): the bar
 * with level celebrations and the still-missing line. The "+N" after Hotovo floats where he
 * tapped (TakerBoard). The meeting time from mockup Main comes with periods (#42).
 */
export function MyPoints({ points, me }: { points: PointsOverview; me: number }) {
  const mine = points.takers.find((t) => t.id === me)
  if (!mine) return null
  return (
    <Card className="grid gap-2">
      <PointsBar
        confirmed={mine.confirmed}
        pending={mine.pending}
        lower={points.levels.lower}
        upper={points.levels.upper}
        celebrate
        subject={String(me)}
      />
      <p className="text-sm font-semibold text-muted">
        {missingLine(mine.confirmed, points.levels)}
      </p>
    </Card>
  )
}
