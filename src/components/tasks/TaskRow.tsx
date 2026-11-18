import type { ReactNode } from 'react'
import type { ItemStateKey } from '~/lib/strings'
import { cn } from '~/lib/utils'
import { StateChip } from './StateChip'
import { STATE_STRIPE, STATE_TEXT } from './stateStyles'

/** Points take the state colour where it means something (UI doc §2.2): waiting or counted. */
const POINTS_COLOUR: Partial<Record<ItemStateKey, string>> = {
  pending: STATE_TEXT.pending,
  confirmed: STATE_TEXT.confirmed,
}

/**
 * One task line (UI doc §2.2, §5 "Cards, rows"): 4 px state stripe on the left, name, meta
 * line with the state chip, points, and an optional action (e.g. the Hotovo button).
 * `relative`, so a FloatingPoints can sit inside it.
 */
export function TaskRow({
  name,
  state,
  points,
  meta,
  action,
  className,
}: {
  name: ReactNode
  state: ItemStateKey
  points: number
  /** Short secondary line after the chip, e.g. a deadline. */
  meta?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="task-row"
      data-state={state}
      className={cn(
        'relative flex min-h-tap items-center gap-3 rounded-card border-l-4 bg-surface py-2.5 pr-2.5 pl-3 shadow-sticker',
        STATE_STRIPE[state],
        className,
      )}
    >
      <div className="grid min-w-0 flex-1 gap-1">
        {/* Two lines before truncating, so a name still reads next to two action buttons at 360 px. */}
        <div className="line-clamp-2 text-row font-bold break-words">{name}</div>
        <div className="flex min-w-0 items-center gap-2 text-meta text-muted">
          <StateChip state={state} className="min-w-0 shrink" />
          {/* The meta line gives way first; the chip only truncates when nothing else is left. */}
          {meta ? <span className="min-w-0 shrink-[1000] truncate">{meta}</span> : null}
        </div>
      </div>
      <span className={cn('num text-base font-bold whitespace-nowrap', POINTS_COLOUR[state])}>
        {points}
      </span>
      {action}
    </div>
  )
}
