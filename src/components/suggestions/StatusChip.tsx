import { STATE_CHIP_BG, STATE_DOT, STATE_TEXT } from '~/components/tasks/stateStyles'
import { Badge } from '~/components/ui/badge'
import type { SuggestionStatus } from '~/domain'
import type { ItemStateKey } from '~/lib/strings'
import { cs } from '~/lib/strings'
import { cn } from '~/lib/utils'

// A suggestion's state (#247) in the item-state colours: new is open, sent waits, done is done,
// dismissed is cancelled.
const COLOUR: Record<SuggestionStatus, ItemStateKey> = {
  new: 'open',
  sent: 'pending',
  done: 'confirmed',
  dismissed: 'cancelled',
}

export function StatusChip({ status }: { status: SuggestionStatus }) {
  const state = COLOUR[status]
  return (
    <Badge data-status={status} className={cn(STATE_CHIP_BG[state], STATE_TEXT[state])}>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', STATE_DOT[state])} />
      {cs.suggestions.status[status]}
    </Badge>
  )
}
