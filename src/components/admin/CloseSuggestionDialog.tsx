import { useRef, useState } from 'react'
import type { AdminOutcome } from '~/components/disputes/disputeCalls'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { cs } from '~/lib/strings'

// Hotovo and Zamítnout on a suggestion (#247) are final, so they ask first. No text to type, so
// a centred Dialog is fine here. A refusal that makes the row stale is the page's to show
// (toast + reload); any other stays in here with the confirm button for a retry.

const t = cs.suggestions

export type CloseMove = 'done' | 'dismiss'

/** The dialog's body. No hooks, so each state renders in a test. */
export function CloseForm({
  move,
  busy,
  error,
  onConfirm,
}: {
  move: CloseMove
  busy: boolean
  error: string | null
  onConfirm: () => void
}) {
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{move === 'done' ? t.confirmDone : t.confirmDismiss}</DialogTitle>
        <DialogDescription>{t.confirmFinal}</DialogDescription>
      </DialogHeader>
      {error && (
        <p role="alert" className="font-bold text-state-rejected-text">
          {error}
        </p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            {t.cancel}
          </Button>
        </DialogClose>
        <Button
          type="button"
          variant={move === 'done' ? 'ok' : 'no'}
          disabled={busy}
          aria-busy={busy}
          onClick={onConfirm}
        >
          {busy ? t.sending : move === 'done' ? t.done : t.dismiss}
        </Button>
      </DialogFooter>
    </div>
  )
}

export function CloseSuggestionDialog({
  move,
  open,
  onOpenChange,
  onConfirm,
  onDone,
}: {
  move: CloseMove | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<AdminOutcome>
  /** Closed, or refused because the row is stale: the page closes, toasts and reloads. */
  onDone: (outcome: AdminOutcome) => unknown
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sending = useRef(false)

  async function confirm() {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    const outcome = await onConfirm()
    sending.current = false
    setBusy(false)
    if (outcome.ok || outcome.reload) await onDone(outcome)
    else setError(outcome.message)
  }

  return (
    <Dialog
      open={open && move !== null}
      onOpenChange={(next) => {
        if (!next) setError(null)
        onOpenChange(next)
      }}
    >
      <DialogContent>
        {move && (
          <CloseForm
            move={move}
            busy={busy}
            error={error}
            onConfirm={() => {
              void confirm()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
