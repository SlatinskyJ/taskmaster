import { Fingerprint } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { formatPragueDate } from '~/lib/formatDate'
import { cs } from '~/lib/strings'
import type { PasskeySummary } from '~/server/passkeys/functions'

/** One person's passkeys in Profil (UI doc §7.4): device, when added, when last used. */
export function PasskeyList({
  items,
  busyId,
  onRemove,
}: {
  items: readonly PasskeySummary[]
  /** The row whose removal is running; its button is disabled. */
  busyId: number | null
  onRemove: (item: PasskeySummary) => void
}) {
  if (items.length === 0) {
    return <p className="font-bold text-muted">{cs.passkeys.empty}</p>
  }
  return (
    <ul className="grid gap-2">
      {items.map((p) => (
        <li key={p.id} className="flex min-h-tap items-center gap-3">
          <Fingerprint aria-hidden="true" className="size-6 shrink-0 text-muted" />
          <span className="grid min-w-0 flex-1">
            <b className="text-row font-extrabold">{cs.passkeys.device[p.deviceKind]}</b>
            <span className="text-meta font-bold text-muted">
              {cs.passkeys.addedOn(formatPragueDate(p.createdAt))} ·{' '}
              {p.lastUsedAt
                ? cs.passkeys.lastUsed(formatPragueDate(p.lastUsedAt))
                : cs.passkeys.neverUsed}
            </span>
          </span>
          <Button
            variant="no"
            disabled={busyId === p.id}
            onClick={() => {
              onRemove(p)
            }}
          >
            {cs.passkeys.remove}
          </Button>
        </li>
      ))}
    </ul>
  )
}
