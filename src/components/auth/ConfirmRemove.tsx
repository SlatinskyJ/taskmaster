import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { cs } from '~/lib/strings'

/** The confirm before removing passkeys (UI doc §5: can't be undone). */
export function ConfirmRemove({
  title,
  text,
  confirm,
  busy,
  onConfirm,
  onClose,
}: {
  /** Null keeps the dialog closed. */
  title: string | null
  text: string
  confirm: string
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      open={title !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{text}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {cs.passkeys.cancel}
          </Button>
          <Button variant="no" disabled={busy} onClick={onConfirm}>
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
