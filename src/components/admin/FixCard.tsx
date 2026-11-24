import type { AdminOutcome } from '~/components/disputes/disputeCalls'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import type { FixTaker } from '~/server/corrections/functions'
import type { AdminDisputeEntry } from '~/server/disputes/functions'
import type { FixStart } from './fixDraft'

// Opravy bodů on Správa (#48, UI doc §7.5 AFix, spec §5.9): the admin adds or takes points, or
// corrects a settled week, directly. Also how a Sporné row opens the same sheet, and the
// reason drafts Správa keeps per sheet. Pure: Správa holds the state.

const t = cs.admin.fix

/** What the loader gives the sheet: the boys, the switch off (no section), or a failed fetch. */
export type FixableData = FixTaker[] | { error: 'feature_off' } | { error: 'load' }

export async function loadFixable(
  call: () => Promise<FixTaker[] | { error: 'feature_off' }>,
): Promise<FixableData> {
  try {
    return await call()
  } catch {
    return { error: 'load' }
  }
}

/** Opravit on a Sporné row: a settlement is corrected by its level, anything else by points. */
export function fixStartOf(entry: AdminDisputeEntry): FixStart {
  if (entry.item.kind === 'settlement') {
    return { mode: 'week', takerId: entry.takerId, settlementId: entry.item.id, dispute: entry }
  }
  return { mode: 'points', takerId: entry.takerId, dispute: entry }
}

/** Where a sheet's typed reason is kept: one per dispute, one per direct mode. */
export const draftKey = (start: FixStart) =>
  start.dispute ? `dispute:${String(start.dispute.id)}` : `direct:${start.mode}`

/** After a send: a sent fix drops its draft; a stale row keeps it for the next try. */
export function afterFix(
  drafts: Readonly<Record<string, string>>,
  key: string,
  outcome: AdminOutcome,
): Record<string, string> {
  return Object.fromEntries(Object.entries(drafts).filter(([k]) => !outcome.ok || k !== key))
}

export function FixCard({
  failed,
  onAdjust,
  onCorrect,
  onRetry,
}: {
  failed: boolean
  onAdjust: () => void
  onCorrect: () => void
  onRetry: () => void
}) {
  return (
    <section className="mb-3.5 grid gap-2" aria-labelledby="admin-fix-label">
      <SectionLabel id="admin-fix-label">{t.title}</SectionLabel>
      <div className="grid gap-2 rounded-card bg-surface p-3 shadow-sticker">
        {failed ? (
          <>
            <p role="alert" className="font-bold text-state-rejected-text">
              {t.loadError}
            </p>
            <Button type="button" variant="ghost" onClick={onRetry}>
              {t.retry}
            </Button>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={onAdjust}>
              {t.adjust}
            </Button>
            <Button type="button" variant="ghost" onClick={onCorrect}>
              {t.correct}
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
