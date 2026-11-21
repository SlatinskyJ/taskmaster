import { useState } from 'react'
import { useEffectsEnabled } from '~/lib/effects'
import { cn } from '~/lib/utils'

/**
 * Floating "+N" (UI doc §4): pending colour when a taker marks a task done, green when a giver
 * confirms. Place it inside a `relative` parent; it removes itself after the animation.
 * Render a new one with a fresh `key` per event. Nothing shows when effects are off.
 */
export function FloatingPoints({
  points,
  tone,
  className,
  onDone,
}: {
  points: number
  tone: 'pending' | 'confirmed'
  className?: string
  /** Called once the float has played. */
  onDone?: () => void
}) {
  const enabled = useEffectsEnabled()
  const [done, setDone] = useState(false)
  if (!enabled || done) return null
  return (
    <span
      aria-hidden
      onAnimationEnd={() => {
        setDone(true)
        onDone?.()
      }}
      className={cn(
        'pointer-events-none absolute -top-2 right-4 z-10 animate-float-up num text-2xl font-bold',
        tone === 'pending' ? 'text-state-pending' : 'text-state-confirmed',
        className,
      )}
    >
      +{points}
    </span>
  )
}
