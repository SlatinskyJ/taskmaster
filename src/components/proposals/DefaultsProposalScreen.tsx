import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { DefaultWeekView } from '~/components/admin/DefaultWeekCard'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Dialog, DialogContent } from '~/components/ui/dialog'
import type { PeriodDefaults } from '~/domain'
import { cs } from '~/lib/strings'
import type { ProposalsView } from '~/server/periods/functions'
import { asksFirst, callProposalAction, proposeDefaults, runProposalCall } from './proposalCalls'
import type { CallUi, ProposalAction } from './proposalCalls'
import { busyKey, ConfirmBody, ProposalCard } from './ProposalCard'
import { defaultsNowLine, defaultsRows } from './proposalRows'

const t = cs.proposals

export interface DefaultsProposalViewProps {
  view: ProposalsView
  me: number
  form: PeriodDefaults
  busy: string | null
  error: string | null
  onChange: (d: PeriodDefaults) => void
  onPropose: () => void
  onAct: (action: ProposalAction) => void
}

/**
 * Výchozí týden for parents (UI doc §7.2 GDefaults): the Správa form sent as a proposal, or the
 * pending proposal's card (the server allows one pending at a time). Pure.
 */
export function DefaultsProposalView({
  view,
  me,
  form,
  busy,
  error,
  onChange,
  onPropose,
  onAct,
}: DefaultsProposalViewProps) {
  if (view.defaults) {
    return (
      <section className="grid gap-2">
        <SectionLabel>{t.defaultsSection}</SectionLabel>
        <ProposalCard
          kind="defaults"
          proposal={view.defaults}
          parties={view.parties}
          me={me}
          rows={defaultsRows(view.defaults, view.currentDefaults)}
          busy={busy}
          error={error}
          onAct={onAct}
        />
      </section>
    )
  }
  return (
    <div className="grid gap-2">
      <p className="text-meta font-bold text-muted">{defaultsNowLine(view.currentDefaults)}</p>
      <DefaultWeekView
        saved={view.currentDefaults}
        form={form}
        busy={busy === 'propose'}
        error={error}
        onChange={onChange}
        onSave={onPropose}
        saveLabel={t.proposeAll}
        busyLabel={t.sending}
        hint={t.defaultsHint}
      />
    </div>
  )
}

export function DefaultsProposalScreen({ view, me }: { view: ProposalsView; me: number }) {
  const router = useRouter()
  const [form, setForm] = useState(view.currentDefaults)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ask, setAsk] = useState<'reject' | 'withdraw' | null>(null)

  const ui: CallUi = {
    busy: setBusy,
    error: setError,
    success: (text) => toast.success(text),
    reload: () => router.invalidate(),
  }

  async function act(action: ProposalAction) {
    const p = view.defaults
    if (!p) return
    await runProposalCall(
      busyKey('defaults', action),
      () => callProposalAction(action, 'defaults', p.id),
      t.done[action],
      ui,
    )
    setAsk(null)
  }

  return (
    <>
      <DefaultsProposalView
        view={view}
        me={me}
        form={form}
        busy={busy}
        error={error}
        onChange={(d) => {
          setError(null)
          setForm(d)
        }}
        onPropose={() => {
          void runProposalCall('propose', () => proposeDefaults(form), t.sent, ui)
        }}
        onAct={(action) => {
          if (asksFirst(action)) setAsk(action)
          else void act(action)
        }}
      />
      <Dialog
        open={ask !== null}
        onOpenChange={(open) => {
          if (!open) setAsk(null)
        }}
      >
        <DialogContent>
          {ask && (
            <ConfirmBody
              kind="defaults"
              action={ask}
              busy={busy !== null}
              onConfirm={() => {
                void act(ask)
              }}
              onBack={() => {
                setAsk(null)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
