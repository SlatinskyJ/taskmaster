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
      className={cn(fieldClass, 'min-h-tap text-base', className)}
      {...props}
    />
  )
}
