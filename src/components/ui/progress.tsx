import { Progress as ProgressPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '~/lib/utils'

// Plain bar in the theme. The points bar (#32) extends it with pending stripes and level ticks.
export function Progress({
  className,
  value,
  ...props
}: ComponentProps<typeof ProgressPrimitive.Root>) {
  const clamped = Math.min(100, Math.max(0, value ?? 0))
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn('relative h-3.5 w-full overflow-hidden rounded-full bg-track', className)}
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 rounded-full bg-state-confirmed transition-transform duration-700"
        style={{ transform: `translateX(-${String(100 - clamped)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}
