import { sectionLabelClass } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { Textarea } from '~/components/ui/textarea'
import { DISPUTE_REASON_MAX } from '~/lib/disputeLimits'
import { cs } from '~/lib/strings'

// TDispute (UI doc §7.1): what is disputed, its value now, the reason, what sending does. No
// hooks, so each state renders in a test; DisputeDrawer holds the state.
export function DisputeForm({
  what,
  value,
  reason,
  busy,
  error,
  onReason,
  onSend,
}: {
  what: string
  value: string
  reason: string
  busy: boolean
  error: string | null
  onReason: (reason: string) => void
  onSend: () => void
}) {
  const empty = reason.trim() === ''
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (!empty && !busy) onSend()
      }}
    >
      <div className="grid gap-0.5 rounded-button bg-track/40 px-3 py-2">
        <span className="text-meta font-bold text-muted">{what}</span>
        <span className="font-bold break-words">{value}</span>
      </div>
      <label className="grid gap-1.5">
        <span className={sectionLabelClass}>{cs.disputes.reasonLabel}</span>
        <Textarea
          name="reason"
          required
          maxLength={DISPUTE_REASON_MAX}
          value={reason}
          onChange={(e) => {
            onReason(e.target.value)
          }}
        />
      </label>
      {error && (
        <p role="alert" className="text-meta font-bold text-state-rejected-text">
          {error}
        </p>
      )}
      <p className="text-meta text-muted">{cs.disputes.note}</p>
      <Button type="submit" size="lg" disabled={empty || busy} aria-busy={busy}>
        {busy ? cs.disputes.sending : cs.disputes.send}
      </Button>
    </form>
  )
}
