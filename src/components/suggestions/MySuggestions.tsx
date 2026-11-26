import { formatPragueDate } from '~/lib/formatDate'
import { cs } from '~/lib/strings'
import type { MySuggestion } from '~/server/suggestions/functions'
import { StatusChip } from './StatusChip'

// Moje návrhy on Profil (#247): the caller's suggestions as the server sends them (newest
// first), each with its state and, once sent, a link to the issue. Text wraps, never cut.

export function SuggestionText({
  title,
  description,
}: {
  title: string
  description: string | null
}) {
  return (
    <>
      <b className="text-row font-bold break-words">{title}</b>
      {description && (
        <p className="text-meta break-words whitespace-pre-line text-muted">{description}</p>
      )}
    </>
  )
}

export function IssueLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-tap w-fit items-center font-bold underline decoration-1 underline-offset-4"
    >
      {cs.suggestions.issueLink}
    </a>
  )
}

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
