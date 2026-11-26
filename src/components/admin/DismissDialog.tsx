import { useReducer } from 'react'
import type { AdminOutcome } from '~/components/disputes/disputeCalls'
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
          className="max-h-48 overflow-y-auto"
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

/** The dialog's state: the note, a request on its way, and an error shown in the dialog. */
export interface DismissState {
  note: string
  busy: boolean
  error: string | null
}

export type DismissAction =
  | { type: 'note'; note: string }
  | { type: 'send' }
  | { type: 'answer'; outcome: AdminOutcome }
  | { type: 'close' }

export const DISMISS_START: DismissState = { note: '', busy: false, error: null }

/** Kept, or refused because the row is stale: the dialog closes (the page toasts and reloads). */
export const closesDialog = (o: AdminOutcome) => o.ok || o.reload

/**
 * What each step does to the dialog. A refusal that leaves the row valid (an empty note, a
 * failed request) keeps the note and shows why; closing starts the next row empty.
 */
export function dismissReducer(state: DismissState, action: DismissAction): DismissState {
  switch (action.type) {
    case 'note':
      return { ...state, note: action.note, error: null }
    case 'send':
      return { ...state, busy: true, error: null }
    case 'answer':
      if (closesDialog(action.outcome)) return DISMISS_START
      return { ...state, busy: false, error: action.outcome.ok ? null : action.outcome.message }
    case 'close':
      return DISMISS_START
  }
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
  onConfirm: (note: string) => Promise<AdminOutcome>
  /** Kept, or refused because the row is stale: the page closes, toasts and reloads. */
  onDone: (outcome: AdminOutcome) => Promise<void>
}) {
  const [state, dispatch] = useReducer(dismissReducer, DISMISS_START)

  async function confirm() {
    dispatch({ type: 'send' })
    const outcome = await onConfirm(state.note)
    dispatch({ type: 'answer', outcome })
    if (closesDialog(outcome)) await onDone(outcome)
  }

  return (
    <Dialog
      open={open && lines !== null}
      onOpenChange={(next) => {
        if (!next) dispatch({ type: 'close' })
        onOpenChange(next)
      }}
    >
      <DialogContent>
        {lines && (
          <DismissForm
            lines={lines}
            note={state.note}
            busy={state.busy}
            error={state.error}
            onNote={(note) => {
              dispatch({ type: 'note', note })
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
