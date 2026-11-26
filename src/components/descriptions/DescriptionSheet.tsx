import { useState } from 'react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '~/components/ui/drawer'
import { cs } from '~/lib/strings'
import { changeDescriptionFn } from '~/server/descriptions/functions'
import type { DescriptionTarget } from '~/server/descriptions/functions'
import { sendDescription } from './descriptionCalls'
import type { DescriptionCallResult } from './descriptionCalls'
import { DescriptionForm } from './DescriptionForm'

type Saved = Extract<DescriptionCallResult<'applied' | 'waiting' | 'withdrawn'>, { ok: true }>

// The bottom sheet that writes or changes a description (#207). The block remounts it (`key`)
// on each open, so it starts from `start` again. The vaul Drawer moves above the
// phone keyboard by itself (CLAUDE.md forms rule).
export function DescriptionSheet({
  open,
  onOpenChange,
  target,
  start,
  warn,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: DescriptionTarget
  /** The text the form opens with: `sheetStart`. */
  start: string
  warn: string
  onSaved: (outcome: Saved['outcome']) => void
}) {
  const [text, setText] = useState(start)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    const r = await sendDescription(target, text, changeDescriptionFn)
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onSaved(r.outcome)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader>
          <DrawerTitle>{cs.description.sheetTitle}</DrawerTitle>
        </DrawerHeader>
        <DescriptionForm
          text={text}
          warn={warn}
          busy={busy}
          error={error}
          onText={(t) => {
            setText(t)
            setError(null)
          }}
          onSave={() => void save()}
        />
      </DrawerContent>
    </Drawer>
  )
}
