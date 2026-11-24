import type { ComponentProps } from 'react'
import { cn } from '~/lib/utils'

/** Shared field look for Input, Textarea and the Select trigger. */
export const fieldClass =
  'w-full min-w-0 rounded-button border-2 border-track bg-surface px-3 text-ink transition-colors outline-none placeholder:text-muted focus-visible:border-accent2 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-state-rejected'

export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClass,
        'min-h-tap text-base',
        // iOS gives time and date fields a native look with its own minimum width, wider than
        // a half-width column (#216). Without it they take the width they are given.
        (type === 'time' || type === 'date') &&
          'appearance-none [&::-webkit-date-and-time-value]:text-left',
        className,
      )}
      {...props}
    />
  )
}
