import { sectionLabelClass } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { DESCRIPTION_MAX } from '~/domain/description'
import { cs } from '~/lib/strings'

// The edit sheet's form (#207): the text, its count, what saving does, Uložit. No hooks, so each
// state renders in a test; DescriptionSheet holds the state. A failure keeps the typed text.
export function DescriptionForm({
  text,
  warn,
  busy,
  error,
  onText,
  onSave,
}: {
  text: string
  /** What saving does here: resets agreements (proposed) or waits for the brothers. */
  warn: string
  busy: boolean
  error: string | null
  onText: (text: string) => void
  onSave: () => void
}) {
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy) onSave()
      }}
    >
      <label className="grid gap-1.5">
        <span className={sectionLabelClass}>{cs.description.field}</span>
        <Textarea
          name="description"
          maxLength={DESCRIPTION_MAX}
          rows={6}
          value={text}
          onChange={(e) => {
            onText(e.target.value)
          }}
        />
      </label>
      <p className="text-meta text-muted" aria-live="polite">
        {cs.description.count(text.length)}
      </p>
      {error && (
        <p role="alert" className="text-meta font-bold text-state-rejected-text">
          {error}
        </p>
      )}
      <p className="text-meta text-muted">{warn}</p>
      <Button type="submit" size="lg" disabled={busy} aria-busy={busy}>
        {busy ? cs.description.saving : cs.description.save}
      </Button>
    </form>
  )
}
