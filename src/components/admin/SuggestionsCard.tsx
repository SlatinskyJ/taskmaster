import { Avatar } from '~/components/shell/Avatar'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { IssueLink, SuggestionText } from '~/components/suggestions/SuggestionRow'
import { StatusChip } from '~/components/suggestions/StatusChip'
import { Button } from '~/components/ui/button'
import { formatPragueDate } from '~/lib/formatDate'
import { cs } from '~/lib/strings'
import type { AdminSuggestion } from '~/server/suggestions/functions'

// Návrhy on Správa (#247, spec §5.13, UI doc §7.5): everyone's suggestions, newest first, with
// who wrote them. A new one can be marked done, dismissed or sent to GitHub; a sent one only
// marked done; done and dismissed are final. Pure: Správa holds the dialog and the sheet.

const t = cs.suggestions

/** What the loader gives the card: the list, the switch off (no section), or a failed fetch. */
export type AdminSuggestionsData =
  { items: AdminSuggestion[]; canSend: boolean } | { error: 'feature_off' } | { error: 'load' }

/** The loader's step: a fetch that throws becomes the retry state, not a broken Správa. */
export async function loadAdminSuggestions(
  call: () => Promise<{ items: AdminSuggestion[]; canSend: boolean } | { error: 'feature_off' }>,
): Promise<AdminSuggestionsData> {
  try {
    return await call()
  } catch {
    return { error: 'load' }
  }
}

export function SuggestionsCard({
  data,
  onClose,
  onSend,
  onRetry,
}: {
  data: AdminSuggestionsData
  onClose: (item: AdminSuggestion, move: 'done' | 'dismiss') => void
  onSend: (item: AdminSuggestion) => void
  onRetry: () => void
}) {
  if ('error' in data && data.error === 'feature_off') return null
  const items = 'items' in data ? data.items : null
  const newCount = items ? items.filter((s) => s.status === 'new').length : 0
  return (
    <section className="mb-3.5 grid gap-2" aria-labelledby="admin-suggestions-label">
      <SectionLabel id="admin-suggestions-label">{t.adminTitle(newCount)}</SectionLabel>
      {items === null ? (
        <div className="grid gap-2 rounded-card bg-surface p-3 shadow-sticker">
          <p role="alert" className="font-bold text-state-rejected-text">
            {t.loadError}
          </p>
          <Button type="button" variant="ghost" onClick={onRetry}>
            {t.retry}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-card bg-surface p-3 text-muted shadow-sticker">{t.adminEmpty}</p>
      ) : (
        <ul className="grid gap-2">
          {items.map((s) => {
            const titleId = `admin-suggestion-${String(s.id)}`
            const open = s.status === 'new' || s.status === 'sent'
            return (
              <li
                key={s.id}
                data-suggestion={s.id}
                className="grid min-w-0 gap-1 rounded-card bg-surface p-3 shadow-sticker"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <StatusChip status={s.status} />
                  <span className="text-meta font-bold text-muted">
                    {formatPragueDate(s.createdAt)}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar userId={s.author.id} name={s.author.displayName} />
                  <span className="min-w-0 font-extrabold break-words">{s.author.displayName}</span>
                </span>
                <div id={titleId} className="grid gap-1">
                  <SuggestionText title={s.title} description={s.description} />
                </div>
                {s.issueUrl && <IssueLink url={s.issueUrl} />}
                {open && (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      aria-describedby={titleId}
                      onClick={() => {
                        onClose(s, 'done')
                      }}
                    >
                      {t.done}
                    </Button>
                    {s.status === 'new' && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          aria-describedby={titleId}
                          onClick={() => {
                            onClose(s, 'dismiss')
                          }}
                        >
                          {t.dismiss}
                        </Button>
                        <Button
                          type="button"
                          aria-describedby={titleId}
                          onClick={() => {
                            onSend(s)
                          }}
                        >
                          {t.sendRow}
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
