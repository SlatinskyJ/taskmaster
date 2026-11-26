import { formatPragueDate } from '~/lib/formatDate'
import { cs } from '~/lib/strings'
import type { MySuggestion } from '~/server/suggestions/functions'
import { StatusChip } from './StatusChip'
import { IssueLink, SuggestionText } from './SuggestionRow'

// Moje návrhy on Profil (#247): the caller's suggestions as the server sends them (newest
// first), each with its state and, once sent, a link to the issue.

export function MySuggestions({ items }: { items: MySuggestion[] }) {
  if (items.length === 0)
    return (
      <p className="rounded-card bg-surface p-3 text-muted shadow-sticker">
        {cs.suggestions.mineEmpty}
      </p>
    )
  return (
    <ul className="grid gap-2">
      {items.map((s) => (
        <li
          key={s.id}
          data-suggestion={s.id}
          className="grid min-w-0 gap-1 rounded-card bg-surface p-3 shadow-sticker"
        >
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip status={s.status} />
            <span className="text-meta font-bold text-muted">{formatPragueDate(s.createdAt)}</span>
          </span>
          <SuggestionText title={s.title} description={s.description} />
          {s.issueUrl && <IssueLink url={s.issueUrl} />}
        </li>
      ))}
    </ul>
  )
}
