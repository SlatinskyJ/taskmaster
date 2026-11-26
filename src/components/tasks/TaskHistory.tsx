import { useState } from 'react'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Card } from '~/components/ui/card'
import { cs } from '~/lib/strings'
import { cn } from '~/lib/utils'
import type { HistoryEntry } from '~/server/tasks/functions'
import { historyItems } from './historyText'

/**
 * Everything that happened to the task, oldest first (#36, mockup GTask "Historie"), as chat
 * bubbles (#248, Jakub 2026-11-26): mine on the left and dark, everyone else's on the right, the
 * system's a centred note. The time shows under an entry after a tap, a second tap hides it.
 */
export function TaskHistory({ entries, meId }: { entries: readonly HistoryEntry[]; meId: number }) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set())
  if (entries.length === 0) return null
  const toggle = (id: number) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }
  const timeId = (id: number) => `history-time-${String(id)}`
  return (
    <section className="grid gap-2" aria-labelledby="history-label">
      <SectionLabel id="history-label">{cs.history.title}</SectionLabel>
      <Card className="grid gap-2">
        <ol>
          {historyItems(entries, meId).map((item) => {
            if (item.kind === 'round') {
              return (
                <li
                  key={item.key}
                  role="separator"
                  aria-label={cs.history.round(item.round)}
                  className="mt-3.5 flex items-center gap-2 text-meta font-bold text-accent-strong first:mt-0"
                  data-round={item.round}
                >
                  <span aria-hidden="true" className="h-px flex-1 bg-track" />
                  <span className="flex-none">{cs.history.round(item.round)}</span>
                  <span aria-hidden="true" className="h-px flex-1 bg-track" />
                </li>
              )
            }
            const shown = open.has(item.id)
            const time = (
              <p
                id={timeId(item.id)}
                hidden={!shown}
                className="px-1.5 text-xs font-medium text-muted"
              >
                {item.time}
              </p>
            )
            if (item.kind === 'note') {
              return (
                <li
                  key={item.id}
                  className="mt-3.5 flex flex-col items-center text-center first:mt-0"
                >
                  <button
                    type="button"
                    aria-expanded={shown}
                    aria-controls={timeId(item.id)}
                    className="min-h-tap max-w-full px-2"
                    onClick={() => {
                      toggle(item.id)
                    }}
                  >
                    <span className="inline-block rounded-full bg-track px-3 py-1 text-meta font-bold break-words text-muted">
                      {item.text}
                      {item.reason && <span className="block font-medium">{item.reason}</span>}
                    </span>
                  </button>
                  {time}
                </li>
              )
            }
            const mine = item.side === 'mine'
            return (
              <li
                key={item.id}
                className={cn(
                  'flex flex-col gap-0.5',
                  mine ? 'items-start' : 'items-end',
                  item.joinAbove ? 'mt-[3px]' : 'mt-3.5 first:mt-0',
                )}
              >
                {item.name && (
                  <span className="max-w-[80%] px-1.5 text-right text-xs font-extrabold break-words text-muted">
                    {item.name}
                  </span>
                )}
                <button
                  type="button"
                  aria-expanded={shown}
                  aria-controls={timeId(item.id)}
                  className={cn(
                    'min-h-tap max-w-[80%] rounded-[18px] px-3 py-2 text-left font-bold break-words',
                    mine
                      ? 'rounded-tl-[4px] bg-ink text-bg'
                      : 'rounded-tr-[4px] border border-track bg-surface text-ink shadow-sticker',
                    item.joinBelow && (mine ? 'rounded-bl-[4px]' : 'rounded-br-[4px]'),
                  )}
                  onClick={() => {
                    toggle(item.id)
                  }}
                >
                  {item.text}
                  {item.reason && (
                    <span className={cn('block font-medium', mine ? 'text-bg/75' : 'text-muted')}>
                      {item.reason}
                    </span>
                  )}
                </button>
                {time}
              </li>
            )
          })}
        </ol>
      </Card>
    </section>
  )
}
