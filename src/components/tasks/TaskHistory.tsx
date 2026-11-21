import { SectionLabel } from '~/components/shell/SectionLabel'
import { Card } from '~/components/ui/card'
import { cs } from '~/lib/strings'
import type { HistoryEntry } from '~/server/tasks/functions'
import { historyLine, historyReason } from './historyText'

/** Everything that happened to the task, oldest first (#36, mockup GTask "Historie"). */
export function TaskHistory({ entries, meId }: { entries: readonly HistoryEntry[]; meId: number }) {
  if (entries.length === 0) return null
  return (
    <section className="grid gap-2" aria-labelledby="history-label">
      <SectionLabel id="history-label">{cs.history.title}</SectionLabel>
      <Card className="grid gap-2">
        <ol className="grid gap-2">
          {entries.map((e) => {
            const reason = historyReason(e)
            return (
              <li key={e.id} className="flex gap-2.5 text-meta font-bold">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-2 flex-none rounded-full bg-track"
                />
                <span className="min-w-0 break-words">
                  {historyLine(e, meId)}
                  {reason && (
                    <>
                      <br />
                      <span className="font-medium text-muted">{reason}</span>
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
      </Card>
    </section>
  )
}
