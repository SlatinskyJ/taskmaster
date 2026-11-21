import { cs } from '~/lib/strings'
import { cn } from '~/lib/utils'
import type { ThreadEntry } from '~/server/tasks/functions'
import { threadTime } from './taskView'

const STATE_WORD: Record<Exclude<ThreadEntry['state'], 'open'>, string> = {
  replaced: cs.bids.replaced,
  accepted: cs.bids.accepted,
  closed: cs.bids.closed,
}

function who(entry: ThreadEntry, me: number): string {
  const mine = entry.by.id === me
  if (entry.side === 'giver') return mine ? cs.bids.youOffer : `${entry.by.name} ${cs.bids.offers}`
  return mine ? cs.bids.youWant : `${entry.by.name} ${cs.bids.wants}`
}

/** Every offer and bid of a task, oldest first (spec §5.2: every bid and counter is visible). */
export function BidThread({ entries, me }: { entries: readonly ThreadEntry[]; me: number }) {
  return (
    <ol className="grid gap-1.5">
      {entries.map((entry) => {
        const open = entry.state === 'open'
        return (
          <li
            key={entry.id}
            className={cn(
              'flex flex-wrap items-baseline gap-x-2 break-words',
              open ? 'font-bold' : 'text-muted',
            )}
          >
            <span className="min-w-0">
              {who(entry, me)} <span className="num">{entry.score}</span>
            </span>
            <span className="text-meta text-muted">{threadTime(entry.at)}</span>
            {entry.state === 'open' ? null : (
              <span className="text-meta">{STATE_WORD[entry.state]}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
