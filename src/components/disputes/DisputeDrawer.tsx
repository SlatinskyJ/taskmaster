import { useState } from 'react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '~/components/ui/drawer'
import { cs } from '~/lib/strings'
import type { DisputeItem } from '~/server/disputes/functions'
import { openDisputeFn } from '~/server/disputes/functions'
import type { OpenableKind } from '~/server/disputes/functions'
import { sendDispute } from './disputeCalls'
import { DisputeForm } from './DisputeForm'

// The dispute bottom sheet (UI doc §5, §7.1 TDispute). A failure keeps it open with the typed
// reason, so the person can tap again.
export function DisputeDrawer({
  open,
  onOpenChange,
  item,
  what,
  value,
  onSent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: DisputeItem & { kind: OpenableKind }
  what: string
  value: string
  onSent: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    setBusy(true)
    setError(null)
    const message = await sendDispute(openDisputeFn, { kind: item.kind, id: item.id, reason })
    setBusy(false)
    if (message) {
      setError(message)
      return
    }
    setReason('')
    onSent()
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader>
          <DrawerTitle>{cs.disputes.action}</DrawerTitle>
        </DrawerHeader>
        <DisputeForm
          what={what}
          value={value}
          reason={reason}
          busy={busy}
          error={error}
          onReason={(r) => {
            setReason(r)
            setError(null)
          }}
          onSend={() => void send()}
        />
      </DrawerContent>
    </Drawer>
  )
}
