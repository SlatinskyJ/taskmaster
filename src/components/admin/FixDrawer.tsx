import { useState } from 'react'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '~/components/ui/drawer'
import type { AdminOutcome } from '~/components/disputes/disputeCalls'
import { cs } from '~/lib/strings'
import { adjustPointsFn, correctSettlementFn } from '~/server/corrections/functions'
import type { FixTaker } from '~/server/corrections/functions'
import { sendFix } from './fixCalls'
import { fixRequest, initialDraft } from './fixDraft'
import type { FixDraft, FixStart } from './fixDraft'
import { FixForm } from './FixForm'

// The fix sheet (#48, UI doc AFix): a bottom sheet, so the typed field stays above the phone
// keyboard. A refusal keeps it open with the typed reason; a stale row (and success) hands the
// outcome to Správa, which closes it, toasts and reloads. The reason lives in Správa (`reason`,
// `onReason`) so a reload keeps it. Správa remounts this per start (`key`).

export function FixDrawer({
  open,
  onOpenChange,
  start,
  fixable,
  reason,
  onReason,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  start: FixStart
  fixable: readonly FixTaker[]
  reason: string
  onReason: (reason: string) => void
  onDone: (outcome: AdminOutcome) => void
}) {
  const [draft, setDraft] = useState<FixDraft>(() => initialDraft(start, reason))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    const req = fixRequest(draft, start, fixable)
    if (!req) return
    setBusy(true)
    setError(null)
    const outcome = await sendFix({ adjust: adjustPointsFn, correct: correctSettlementFn }, req)
    setBusy(false)
    if (outcome.ok || outcome.reload) onDone(outcome)
    else setError(outcome.message)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader>
          <DrawerTitle>
            {start.mode === 'points' ? cs.admin.fix.sheetAdjust : cs.admin.fix.sheetCorrect}
          </DrawerTitle>
        </DrawerHeader>
        {/* The week mode's pills make the sheet taller than what the keyboard leaves. */}
        <DrawerBody>
          <FixForm
            start={start}
            fixable={fixable}
            draft={draft}
            busy={busy}
            error={error}
            onChange={(next) => {
              setDraft(next)
              setError(null)
              if (next.reason !== draft.reason) onReason(next.reason)
            }}
            onSend={() => void send()}
          />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}
