import { useState } from 'react'
import type { DismissOutcome } from '~/components/disputes/disputeCalls'
import type { AdminDisputeLines } from '~/components/disputes/disputeProps'
import { sectionLabelClass } from '~/components/shell/SectionLabel'
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
import { Textarea } from '~/components/ui/textarea'
import { DISPUTE_NOTE_MAX } from '~/lib/disputeLimits'
import { cs } from '~/lib/strings'

// Ponechat (#47, spec §5.11 Dismiss): the admin keeps the item as it is, with a note the family
// reads. It can't be undone, so it is a Dialog that says so. A refusal that makes the row stale
// (changed, closed, gone) is the page's to show (toast + reload); any other stays in here.

const t = cs.admin.disputes

/** The dialog's body. No hooks, so each state renders in a test; DismissDialog holds them. */
export function DismissForm({
  lines,
  note,
  busy,
  error,
  onNote,
  onConfirm,
}: {
  lines: AdminDisputeLines
  note: string
  busy: boolean
  error: string | null
  onNote: (note: string) => void
  onConfirm: () => void
}) {
  const empty = note.trim() === ''
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!empty && !busy) onConfirm()
      }}
    >
      <DialogHeader>
        <DialogTitle>{t.dialogTitle}</DialogTitle>
        <DialogDescription>{t.dialogText}</DialogDescription>
      </DialogHeader>
      <div className="grid min-w-0 gap-0.5 rounded-button bg-track/40 px-3 py-2">
        <span className="text-meta font-bold break-words text-muted">{lines.what}</span>
        <span className="font-bold break-words">{lines.value}</span>
      </div>
      <label className="grid gap-1.5">
        <span className={sectionLabelClass}>{t.noteLabel}</span>
        <Textarea
          name="note"
          required
          maxLength={DISPUTE_NOTE_MAX}
          value={note}
          onChange={(e) => {
            onNote(e.target.value)
          }}
          aria-describedby="dismiss-note-hint"
        />
        <span id="dismiss-note-hint" className="text-meta font-bold text-muted">
          {t.noteHint}
        </span>
      </label>
      {error && (
        <p role="alert" className="font-bold text-state-rejected-text">
          {error}
        </p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            {cs.admin.cancel}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={empty || busy} aria-busy={busy}>
          {busy ? t.saving : t.confirm}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function DismissDialog({
  lines,
  open,
  onOpenChange,
  onConfirm,
  onDone,
}: {
  lines: AdminDisputeLines | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (note: string) => Promise<DismissOutcome>
  /** Kept, or refused because the row is stale: the page closes, toasts and reloads. */
  onDone: (outcome: DismissOutcome) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const outcome = await onConfirm(note)
      if (outcome.ok || outcome.reload) {
        setNote('')
        await onDone(outcome)
      } else {
        // The note stays, so the admin can fix it or try again.
        setError(outcome.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open && lines !== null}
      onOpenChange={(next) => {
        if (!next) {
          setNote('')
          setError(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent>
        {lines && (
          <DismissForm
            lines={lines}
            note={note}
            busy={busy}
            error={error}
            onNote={(next) => {
              setNote(next)
              setError(null)
            }}
            onConfirm={() => {
              void confirm()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
