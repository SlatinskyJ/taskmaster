import { Badge } from '~/components/ui/badge'
import { cs, type ItemStateKey } from '~/lib/strings'
import { cn } from '~/lib/utils'
import { STATE_CHIP_BG, STATE_DOT, STATE_TEXT } from './stateStyles'

/** State chip: dot + Czech label on 15 % of the state colour (UI doc §2.2). Sits on `surface`. */
export function StateChip({ state, className }: { state: ItemStateKey; className?: string }) {
  return (
    <Badge data-state={state} className={cn(STATE_CHIP_BG[state], STATE_TEXT[state], className)}>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', STATE_DOT[state])} />
      <span className="truncate">{cs.state[state]}</span>
    </Badge>
  )
}
