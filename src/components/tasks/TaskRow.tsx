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
  detail,
  stateLabel,
  action,
  className,
}: {
  name: ReactNode
  state: ItemStateKey
  points: number
  /** Short secondary line after the chip, e.g. a deadline. */
  meta?: ReactNode
  /** A full line under the meta line that wraps instead of being cut (a template's schedule). */
  detail?: ReactNode
  /** Chip text in place of the state's own label. */
  stateLabel?: string
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
        {/* Two lines before truncating, so a name still reads next to the action at 360 px. */}
        <div className="line-clamp-2 text-row font-bold break-words">{name}</div>
        {/* Chip and meta sit side by side when they fit, else the meta wraps under the chip; an
            item is cut only when it alone is wider than the column (#131). */}
        <div
          data-slot="task-status"
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted"
        >
          <StateChip state={state} label={stateLabel} className="max-w-full" />
          {meta ? (
            <span data-slot="task-meta" className="max-w-full truncate">
              {meta}
            </span>
          ) : null}
        </div>
        {detail ? (
          <p data-slot="task-detail" className="text-meta break-words text-muted">
            {detail}
          </p>
        ) : null}
      </div>
      <span className={cn('num text-base font-bold whitespace-nowrap', POINTS_COLOUR[state])}>
        {points}
      </span>
      {action}
    </div>
  )
}
