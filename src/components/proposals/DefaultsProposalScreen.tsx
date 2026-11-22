import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { DefaultWeekView } from '~/components/admin/DefaultWeekCard'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Dialog, DialogContent } from '~/components/ui/dialog'
import type { PeriodDefaults } from '~/domain'
import { cs } from '~/lib/strings'
import type { ProposalsView } from '~/server/periods/functions'
import { attempt, callProposalAction, proposeDefaults } from './proposalCalls'
import type { ProposalAction } from './proposalCalls'
import { busyKey, ProposalCard } from './ProposalCard'
import { ConfirmBody, defaultsRows } from './NextWeekScreen'

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
  )
}

export function DefaultsProposalScreen({ view, me }: { view: ProposalsView; me: number }) {
  const router = useRouter()
  const [form, setForm] = useState(view.currentDefaults)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ask, setAsk] = useState<'reject' | 'withdraw' | null>(null)

  async function run(key: string, call: () => ReturnType<typeof proposeDefaults>, done: string) {
    setBusy(key)
    setError(null)
    const failed = await attempt(call)
    setBusy(null)
    setAsk(null)
    if (failed) {
      setError(failed)
      return
    }
    toast.success(done)
    await router.invalidate()
  }

  const act = (action: ProposalAction) => {
    const p = view.defaults
    if (!p) return
    void run(
      busyKey('defaults', action),
      () => callProposalAction(action, 'defaults', p.id),
      t.done[action],
    )
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
          void run('propose', () => proposeDefaults(form), t.sent)
        }}
        onAct={(action) => {
          if (action === 'approve') act(action)
          else setAsk(action)
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
              action={ask}
              busy={busy !== null}
              onConfirm={() => {
                act(ask)
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
