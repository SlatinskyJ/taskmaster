import type { ComponentProps } from 'react'
import { cn } from '~/lib/utils'

/** The small upper-case label above a group (mockups: "Lidé", "Vzhled", "Jméno"). */
export const sectionLabelClass = 'text-xs font-extrabold tracking-[.07em] text-muted uppercase'

export function SectionLabel({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn(sectionLabelClass, className)} {...props} />
}
