import { useEffect, useRef, useState } from 'react'
import { FloatingPoints } from '~/components/effects/FloatingPoints'
import { Card } from '~/components/ui/card'
import type { Levels } from '~/domain/settlement'
import { cs } from '~/lib/strings'
import type { PointsOverview } from '~/server/points/functions'
import { PointsBar } from './PointsBar'
import { pointsDelta, type PointsSnapshot } from './pointsDelta'

/** Mockup Main's line under the bar: how far the certain (confirmed) points are from a level. */
export function missingLine(confirmed: number, levels: Levels): string {
  if (confirmed < levels.lower) return cs.points.missingLower(levels.lower - confirmed)
  if (confirmed < levels.upper) return cs.points.missingUpper(levels.upper - confirmed)
  return cs.points.upperDone
}

/**
 * The taker's own points card at the top of Domů (spec §5.7, §7 sketch, mockup Main): the bar
 * with level celebrations, the still-missing line, and a "+N" float when his points go up
 * (UI doc §4). The meeting time from mockup Main comes with periods (#42).
 */
export function MyPoints({ points, me }: { points: PointsOverview; me: number }) {
  const mine = points.takers.find((t) => t.id === me)
  const subject = String(me)
  const last = useRef<PointsSnapshot | null>(null)
  const [float, setFloat] = useState<{
    key: number
    points: number
    tone: 'pending' | 'confirmed'
  } | null>(null)
  const confirmed = mine?.confirmed ?? 0
  const pending = mine?.pending ?? 0

  useEffect(() => {
    const next = { confirmed, pending, subject }
    const delta = pointsDelta(last.current, next)
    last.current = next
    if (delta) setFloat((f) => ({ ...delta, key: (f?.key ?? 0) + 1 }))
  }, [confirmed, pending, subject])

  if (!mine) return null
  return (
    <Card className="relative grid gap-2">
      <PointsBar
        confirmed={mine.confirmed}
        pending={mine.pending}
        lower={points.levels.lower}
        upper={points.levels.upper}
        celebrate
        subject={subject}
      />
      <p className="text-sm font-semibold text-muted">
        {missingLine(mine.confirmed, points.levels)}
      </p>
      {float && <FloatingPoints key={float.key} points={float.points} tone={float.tone} />}
    </Card>
  )
}
