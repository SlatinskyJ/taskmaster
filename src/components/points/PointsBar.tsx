import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { burstConfetti } from '~/components/effects/confetti'
import { useEffectsEnabled } from '~/lib/effects'
import { cs, plural, pointWords } from '~/lib/strings'
import { cn } from '~/lib/utils'
import { levelCrossed, pointsBarLayout } from './pointsBarScale'

/**
 * Points bar (spec §5.7, UI doc §3): confirmed points solid, pending points striped after them,
 * ticks for the lower and upper levels, and the `45 ✔ + 15 ⏳` caption.
 *
 * When confirmed points cross a level between renders, it shows the level toast and, with
 * effects on, glows and bursts confetti (UI doc §4). The first render never celebrates.
 */
export function PointsBar({
  confirmed,
  pending,
  lower,
  upper,
  className,
}: {
  confirmed: number
  pending: number
  lower: number
  upper: number
  className?: string
}) {
  const layout = pointsBarLayout({ confirmed, pending, lower, upper })
  const effects = useEffectsEnabled()
  const [glow, setGlow] = useState(0)
  const previous = useRef(confirmed)

  useEffect(() => {
    const crossed = levelCrossed(previous.current, confirmed, { lower, upper })
    previous.current = confirmed
    if (!crossed) return
    toast(crossed === 'upper' ? cs.effects.upperReached : cs.effects.lowerReached)
    setGlow((g) => g + 1)
    burstConfetti(null, 'big')
  }, [confirmed, lower, upper])

  const label = [
    `${String(confirmed)} ${plural(confirmed, pointWords)} ${cs.points.confirmed}`,
    `${String(pending)} ${cs.points.pending}`,
    `${cs.points.lowerLevel} ${String(lower)}`,
    `${cs.points.upperLevel} ${String(upper)}`,
  ].join(', ')

  return (
    <div
      data-slot="points-bar"
      className={cn('grid gap-1', className)}
      role="group"
      aria-label={label}
    >
      <div
        // A new key restarts the glow animation on every crossing.
        key={glow}
        aria-hidden
        className={cn(
          'relative h-4 rounded-full bg-track',
          effects && glow > 0 && 'animate-bar-glow',
        )}
      >
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full bg-[repeating-linear-gradient(-45deg,var(--s-pending)_0_6px,color-mix(in_srgb,var(--s-pending)_50%,transparent)_6px_12px)]',
            effects && 'bar-grow',
          )}
          style={{ width: `${String(layout.totalPct)}%` }}
        />
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full bg-state-confirmed',
            effects && 'bar-grow',
          )}
          style={{ width: `${String(layout.confirmedPct)}%` }}
        />
        {[layout.lowerPct, layout.upperPct].map((left, i) => (
          <i
            key={i}
            className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink/50"
            style={{ left: `${String(left)}%` }}
          />
        ))}
      </div>
      <div aria-hidden className="relative h-4 text-chip font-bold text-muted">
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap"
          style={{ left: `${String(layout.lowerPct)}%` }}
        >
          {cs.points.lowerTick} {lower}
        </span>
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap"
          style={{ left: `${String(layout.upperPct)}%` }}
        >
          {cs.points.upperTick} {upper}
        </span>
      </div>
      <p aria-hidden className="num text-lg font-bold">
        <span className="text-state-confirmed-text">{confirmed} ✔</span>
        <span className="text-muted"> + </span>
        <span className="text-state-pending-text">{pending} ⏳</span>
      </p>
    </div>
  )
}
