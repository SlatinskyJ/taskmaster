import { useRef, useState } from 'react'
import { sectionLabelClass } from '~/components/shell/SectionLabel'
import { afterSend, canSendIssue, issueInput } from '~/components/suggestions/suggestionForms'
import type { SendOutcome } from '~/components/suggestions/suggestionForms'
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
import { ISSUE_BODY_MAX, issueDraft, SUGGESTION_TITLE_MAX } from '~/domain'
import { cs } from '~/lib/strings'
import type { AdminSuggestion } from '~/server/suggestions/functions'

// Poslat na GitHub (#247, spec §5.13): the admin checks and edits the issue before it goes out.
// Filled from the suggestion without its author's name; the issue is public, and the sheet
// says so. With no token on the server the preview still opens, with the button off. An issue
// GitHub made but the app did not store shows its link and never offers to send again.

const t = cs.suggestions

export interface IssueFields {
  title: string
  body: string
}

/** The sheet's form. No hooks, so each state renders in a test; SendPreview holds them. */
export function SendForm({
  fields,
  canSend,
  busy,
  error,
  notSavedUrl,
  onField,
  onSend,
}: {
  fields: IssueFields
  canSend: boolean
  busy: boolean
  error: string | null
  notSavedUrl: string | null
  onField: (patch: Partial<IssueFields>) => void
  onSend: () => void
}) {
  const ready = canSendIssue({ canSend, busy, notSavedUrl })
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) onSend()
      }}
    >
      <DrawerBody className="flex flex-1 flex-col gap-3 pb-1">
        <p id="send-public-note" className="font-bold text-state-pending-text">
          {t.publicNote}
        </p>
        <div className="grid gap-1.5">
          <label htmlFor="send-title" className={sectionLabelClass}>
            {t.issueTitleLabel}
          </label>
          <Input
            id="send-title"
            name="title"
            autoComplete="off"
            enterKeyHint="next"
            maxLength={SUGGESTION_TITLE_MAX}
            value={fields.title}
            onChange={(e) => {
              onField({ title: e.target.value })
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="send-body" className={sectionLabelClass}>
            {t.issueBodyLabel}
          </label>
          <Textarea
            id="send-body"
            name="body"
            maxLength={ISSUE_BODY_MAX}
            className="max-h-48 overflow-y-auto"
            value={fields.body}
            onChange={(e) => {
              onField({ body: e.target.value })
            }}
          />
        </div>
      </DrawerBody>
      <DrawerFooter>
        {!canSend && <p className="font-bold text-muted">{t.noToken}</p>}
        {notSavedUrl !== null && (
          <div role="alert" className="grid gap-1 font-bold text-state-rejected-text">
            <p>{t.notSaved}</p>
            <a
              href={notSavedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-tap w-fit items-center break-all text-ink underline decoration-1 underline-offset-4"
            >
              {notSavedUrl}
            </a>
          </div>
        )}
        {error && (
          <p role="alert" className="font-bold text-state-rejected-text">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={!ready} aria-busy={busy} className="w-full">
          {busy ? t.sending : t.sendIssue}
        </Button>
      </DrawerFooter>
    </form>
  )
}

/** The preview's state for one suggestion; Správa keys it by the row and the opening. */
export function SendPreview({
  item,
  canSend,
  onSend,
  onSettled,
}: {
  item: AdminSuggestion
  canSend: boolean
  onSend: (input: { id: number; title: string; body: string }) => Promise<SendOutcome>
  /** Sent, stale, or made but not saved: the page closes or reloads. */
  onSettled: (outcome: SendOutcome) => unknown
}) {
  const [fields, setFields] = useState<IssueFields>(() => issueDraft(item))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notSavedUrl, setNotSavedUrl] = useState<string | null>(null)
  // A second tap before React re-renders the disabled button must not send twice.
  const sending = useRef(false)

  async function send() {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    const outcome = await onSend(issueInput(item, fields))
    sending.current = false
    setBusy(false)
    const next = afterSend(outcome)
    setNotSavedUrl(next.notSavedUrl)
    setError(next.error)
    if (next.settle) await onSettled(outcome)
  }

  return (
    <SendForm
      fields={fields}
      canSend={canSend}
      busy={busy}
      error={error}
      notSavedUrl={notSavedUrl}
      onField={(patch) => {
        setFields((f) => ({ ...f, ...patch }))
        setError(null)
      }}
      onSend={() => {
        void send()
      }}
    />
  )
}

export function SendSuggestionDrawer({
  item,
  canSend,
  open,
  onOpenChange,
  onSend,
  onSettled,
}: {
  item: AdminSuggestion | null
  canSend: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSend: (input: { id: number; title: string; body: string }) => Promise<SendOutcome>
  onSettled: (outcome: SendOutcome) => unknown
}) {
  return (
    <Drawer open={open && item !== null} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby="send-public-note">
        <DrawerHeader>
          <DrawerTitle>{t.previewTitle}</DrawerTitle>
        </DrawerHeader>
        {item && (
          <SendPreview
            key={`${String(item.id)}-${String(open)}`}
            item={item}
            canSend={canSend}
            onSend={onSend}
            onSettled={onSettled}
          />
        )}
      </DrawerContent>
    </Drawer>
  )
}
