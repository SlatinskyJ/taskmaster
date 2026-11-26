import { useState } from 'react'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '~/components/ui/drawer'
import { cs } from '~/lib/strings'
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
  item: { kind: OpenableKind; id: number }
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
        {/* A long reason makes the sheet taller than what the keyboard leaves. */}
        <DrawerBody>
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
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}
