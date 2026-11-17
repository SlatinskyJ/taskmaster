import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

/** [call] UI doc §8: an empty list gets one friendly line and, where it fits, the main action. */
export function EmptyState({
  children,
  action,
  className,
}: {
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn('grid justify-items-center gap-3 px-4 py-6 text-center text-muted', className)}
    >
      <p>{children}</p>
      {action}
    </div>
  )
}
