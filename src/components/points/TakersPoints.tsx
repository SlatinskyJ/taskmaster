import { Avatar } from '~/components/shell/Avatar'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Card } from '~/components/ui/card'
import { cs } from '~/lib/strings'
import type { PointsOverview } from '~/server/points/functions'
import { PointsBar } from './PointsBar'

/**
 * "Děti tento týden" on a parent's Domů (mockup GHome, spec §5.7: givers see every taker):
 * each brother's confirmed and pending points against the levels. Quiet bars: the level
 * celebrations belong to the brother's own screen. Renders nothing without takers.
 */
export function TakersPoints({ points }: { points: PointsOverview }) {
  if (points.takers.length === 0) return null
  return (
    <section className="grid gap-2" aria-labelledby="takers-points-label">
      <SectionLabel id="takers-points-label">{cs.points.takersTitle}</SectionLabel>
      <Card className="grid gap-4">
        {points.takers.map((t) => (
          <div key={t.id} className="grid gap-2">
            <div className="flex items-center gap-2">
              <Avatar userId={t.id} name={t.name} className="size-8 text-base" />
              <span className="font-semibold">{t.name}</span>
            </div>
            <PointsBar
              confirmed={t.confirmed}
              pending={t.pending}
              lower={points.levels.lower}
              upper={points.levels.upper}
              celebrate={false}
              subject={String(t.id)}
            />
          </div>
        ))}
      </Card>
    </section>
  )
}
