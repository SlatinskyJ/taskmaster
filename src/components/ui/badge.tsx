import type { ComponentProps } from 'react'
import { cn } from '~/lib/utils'

// Base pill (UI doc §5 Badge). The state chip (#32) builds on it with a dot and a state colour.
export function Badge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="badge"
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full bg-track px-2.5 py-1 font-body text-chip font-bold whitespace-nowrap text-ink',
        className,
      )}
      {...props}
    />
  )
}
