import { cs } from '~/lib/strings'
import type { HistoryEntry } from '~/server/tasks/functions'
import { ChatHistory } from './ChatHistory'
import { historyItems } from './historyText'

/** Everything that happened to the task, newest first (#36, mockup GTask "Historie"; #248). */
export function TaskHistory({ entries, meId }: { entries: readonly HistoryEntry[]; meId: number }) {
  if (entries.length === 0) return null
  return <ChatHistory title={cs.history.title} items={historyItems(entries, meId)} />
}
