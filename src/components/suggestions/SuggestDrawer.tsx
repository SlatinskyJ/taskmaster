import { useRef, useState } from 'react'
import { sectionLabelClass } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '~/components/ui/drawer'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { SUGGESTION_DESCRIPTION_MAX, SUGGESTION_TITLE_MAX } from '~/domain'
import { cs } from '~/lib/strings'
import { createSuggestionFn } from '~/server/suggestions/functions'
import { checkSuggestion, sendNewSuggestion } from './suggestionForms'

// Navrhnout zlepšení (#247): a bottom sheet (it moves above the phone keyboard) with Název and
// Popis. The form is keyed by `open`, so it starts empty each time. No focus on open: on an
// iPhone a focus() outside the tap brings up no keyboard, so the person taps Název once the
// sheet is in place. The server counts the limits; maxLength is a guard.

const t = cs.suggestions

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** After the server took it: close, toast, reload. */
  onSent: () => void
}

export function SuggestDrawer({ open, onOpenChange, onSent }: Props) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby="suggest-note">
        <DrawerHeader>
          <DrawerTitle>{t.sheetTitle}</DrawerTitle>
        </DrawerHeader>
        <SuggestForm key={String(open)} onSent={onSent} />
      </DrawerContent>
    </Drawer>
  )
}

function SuggestForm({ onSent }: { onSent: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A second tap before React re-renders the disabled button must not send twice.
  const sending = useRef(false)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)

  async function submit() {
    if (sending.current) return
    const invalid = checkSuggestion({ title })
    if (invalid) {
      setError(invalid)
      return
    }
    sending.current = true
    setBusy(true)
    setError(null)
    const message = await sendNewSuggestion(createSuggestionFn, { title, description })
    sending.current = false
    setBusy(false)
    if (message === null) onSent()
    else setError(message)
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <DrawerBody className="flex flex-1 flex-col gap-3 pb-1">
        <div className="grid gap-1.5">
          <label htmlFor="suggest-title" className={sectionLabelClass}>
            {t.titleLabel}
          </label>
          <Input
            id="suggest-title"
            name="title"
            autoComplete="off"
            enterKeyHint="next"
            maxLength={SUGGESTION_TITLE_MAX}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              descriptionRef.current?.focus()
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="suggest-description" className={sectionLabelClass}>
            {t.descriptionLabel}
          </label>
          <Textarea
            id="suggest-description"
            ref={descriptionRef}
            name="description"
            maxLength={SUGGESTION_DESCRIPTION_MAX}
            className="max-h-48 overflow-y-auto"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              setError(null)
            }}
          />
        </div>
        <p id="suggest-note" className="text-meta font-bold text-muted">
          {t.note}
        </p>
      </DrawerBody>
      <DrawerFooter>
        {error && (
          <p role="alert" className="font-bold text-state-rejected-text">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={busy} aria-busy={busy} className="w-full">
          {busy ? t.sending : t.send}
        </Button>
      </DrawerFooter>
    </form>
  )
}
