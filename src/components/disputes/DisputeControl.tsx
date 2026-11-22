import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import type { DisputeItem, DisputeMark } from '~/server/disputes/functions'
import type { OpenableKind } from '~/server/disputes/functions'
import { DisputeDrawer } from './DisputeDrawer'
import { DisputeOutcome } from './DisputeOutcome'

// One line on a locked item (#46, spec §5.11): Rozporovat, or Sporné while a dispute is open,
// or the last outcome and Rozporovat again (a closed dispute does not stop a new one).
export function DisputeControl({
  item,
  mark,
  what,
  value,
  name,
  lead,
}: {
  item: DisputeItem & { kind: OpenableKind }
  mark: DisputeMark | null
  /** What is disputed, e.g. "Potvrzené splnění". */
  what: string
  /** The item and its value now, for the drawer (with the boy's name in a giver's view). */
  value: string
  /** The item's name for the button's accessible name. */
  name: string
  /** Show `what` on the line (a card with two controls, the task page). */
  lead?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  return (
    <div
      data-slot="dispute"
      className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1"
    >
      {lead && <span className="text-meta font-bold text-muted">{what}</span>}
      {mark && <DisputeOutcome mark={mark} />}
      {mark?.status !== 'open' && (
        <>
          <Button
            type="button"
            variant="ghost"
            aria-label={cs.disputes.actionFor(what, name)}
            className="ml-auto min-h-tap px-3 text-meta shadow-none"
            onClick={() => {
              setOpen(true)
            }}
          >
            {cs.disputes.action}
          </Button>
          <DisputeDrawer
            open={open}
            onOpenChange={setOpen}
            item={item}
            what={what}
            value={value}
            onSent={() => {
              setOpen(false)
              toast.success(cs.disputes.sent)
              void router.invalidate()
            }}
          />
        </>
      )}
    </div>
  )
}
