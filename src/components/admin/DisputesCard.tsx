import { Link } from '@tanstack/react-router'
import { adminDisputeLines } from '~/components/disputes/disputeProps'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { cs } from '~/lib/strings'
import type { AdminDisputeEntry, DismissDisputeInput } from '~/server/disputes/functions'

// Sporné on Správa (#47, UI doc §7.5 ADisputes, spec §5.11): every open dispute, oldest first,
// with who opened it, what it is, its value now and the reason. Ponechat keeps the item as it is
// with a note (DismissDialog); Opravit (#48) opens the fix sheet. Pure: Správa holds the state.
// A task or chore card opens its page (#222): the name line is a link stretched over the card
// (the #205 row pattern), and the buttons sit above it, so Ponechat and Opravit never open it.

/** The #205 stretched link: the whole card is its tap target and its focus ring. */
const STRETCHED =
  "after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent2 focus-visible:after:outline-solid active:after:bg-current/5"

const t = cs.admin.disputes

/** What the loader gives the card: the list, the switch off (no section), or a failed fetch. */
export type AdminDisputesData = AdminDisputeEntry[] | { error: 'feature_off' } | { error: 'load' }

/** The loader's disputes step: a fetch that throws becomes the retry state, not a broken page. */
export async function loadAdminDisputes(
  call: () => Promise<AdminDisputeEntry[] | { error: 'feature_off' }>,
): Promise<AdminDisputesData> {
  try {
    return await call()
  } catch {
    return { error: 'load' }
  }
}

/** The dismissal for a row: its id and the value it showed, so a changed item is refused. */
export function dismissInput(entry: AdminDisputeEntry, note: string): DismissDisputeInput {
  return { id: entry.id, value: entry.value, note }
}

export function DisputesCard({
  data,
  onKeep,
  onFix,
  onRetry,
}: {
  data: AdminDisputeEntry[] | { error: 'load' }
  onKeep: (entry: AdminDisputeEntry) => void
  onFix: (entry: AdminDisputeEntry) => void
  onRetry: () => void
}) {
  const failed = !Array.isArray(data)
  return (
    <section className="mb-3.5 grid gap-2" aria-labelledby="admin-disputes-label">
      <SectionLabel id="admin-disputes-label">
        {failed ? cs.state.disputed : t.title(data.length)}
      </SectionLabel>
      {failed ? (
        <div className="grid gap-2 rounded-card bg-surface p-3 shadow-sticker">
          <p role="alert" className="font-bold text-state-rejected-text">
            {t.loadError}
          </p>
          <Button type="button" variant="ghost" onClick={onRetry}>
            {t.retry}
          </Button>
        </div>
      ) : data.length === 0 ? (
        <p className="rounded-card bg-surface p-3 text-muted shadow-sticker">{t.empty}</p>
      ) : (
        <ul className="grid gap-2">
          {data.map((e) => {
            const l = adminDisputeLines(e)
            const page = e.page
            return (
              <li
                key={e.id}
                data-admin-dispute={e.id}
                className={cn(
                  'grid min-w-0 gap-1 rounded-card border-l-4 border-l-state-disputed bg-surface py-2.5 pr-2.5 pl-3 shadow-sticker',
                  page && 'relative',
                )}
              >
                <span className="text-meta font-bold break-words text-muted">{l.what}</span>
                <span className="text-row font-bold break-words">
                  {page ? (
                    <Link
                      {...(page.kind === 'task'
                        ? { to: '/ukol/$taskId', params: { taskId: String(page.id) } }
                        : { to: '/sablona/$templateId', params: { templateId: String(page.id) } })}
                      aria-label={t.openFor(cs.disputes.what[e.item.kind], l.name)}
                      className={STRETCHED}
                    >
                      {l.value}
                    </Link>
                  ) : (
                    l.value
                  )}
                </span>
                <span className="text-meta break-words text-muted">{l.opened}</span>
                <blockquote className="rounded-button bg-track/40 px-3 py-2 break-words">
                  {l.reason}
                </blockquote>
                <div className={cn('flex flex-wrap justify-end gap-2', page && 'relative z-10')}>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={t.keepFor(cs.disputes.what[e.item.kind], l.name)}
                    onClick={() => {
                      onKeep(e)
                    }}
                  >
                    {t.keep}
                  </Button>
                  <Button
                    type="button"
                    aria-label={t.fixFor(cs.disputes.what[e.item.kind], l.name)}
                    onClick={() => {
                      onFix(e)
                    }}
                  >
                    {t.fix}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
