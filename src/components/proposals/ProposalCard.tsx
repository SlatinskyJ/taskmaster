import { Check } from 'lucide-react'
import { StateChip } from '~/components/tasks/StateChip'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { cs } from '~/lib/strings'
import type { Party, ProposalView } from '~/server/periods/functions'
import type { ProposalAction } from './proposalCalls'
import type { ChangeRow } from './proposalRows'
import { agreementRows, myActions } from './proposalView'
import type { ProposalKind } from './proposalView'

const t = cs.proposals

/** The key of a pressed button while its call runs: `period:approve`, … */
export const busyKey = (kind: ProposalKind, action: ProposalAction) => `${kind}:${action}`

export interface ProposalCardProps {
  kind: ProposalKind
  proposal: ProposalView<unknown>
  parties: Party[]
  me: number
  rows: ChangeRow[]
  /** "Platí od …" on an agreed proposal. */
  validFrom?: string
  busy: string | null
  error: string | null
  onAct: (action: ProposalAction) => void
}

/**
 * A proposal (UI doc §7.2 Period): who proposed it, old → new values, who agreed, and my
 * buttons. Pure: the screen asks first for Nesouhlasím and Stáhnout návrh, and runs the calls.
 */
export function ProposalCard({
  kind,
  proposal,
  parties,
  me,
  rows,
  validFrom,
  busy,
  error,
  onAct,
}: ProposalCardProps) {
  const proposer = parties.find((p) => p.id === proposal.proposedBy)?.name ?? '?'
  const can = myActions(proposal, me)
  const agreed = proposal.status === 'agreed'
  const button = (action: ProposalAction, label: string, variant: 'ok' | 'no' | 'ghost') => (
    <Button
      variant={variant}
      className="min-h-tap flex-1"
      disabled={busy !== null}
      aria-busy={busy === busyKey(kind, action)}
      onClick={() => {
        onAct(action)
      }}
    >
      {busy === busyKey(kind, action) ? t.sending : label}
    </Button>
  )
  return (
    <Card className="grid gap-3" data-kind={kind}>
      <div className="flex flex-wrap items-center gap-2">
        {agreed ? (
          <StateChip state="confirmed" label={t.agreedChip} />
        ) : (
          <StateChip state="proposed" label={t.proposedBy(proposer)} className="max-w-full" />
        )}
        {agreed && validFrom && (
          <span className="text-meta font-bold text-muted">{t.validFrom(validFrom)}</span>
        )}
      </div>
      <dl className="grid gap-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-baseline justify-between gap-x-3">
            <dt className="text-meta font-bold text-muted">{r.label}</dt>
            <dd className="num font-bold">
              {r.old !== r.now && (
                <>
                  <s className="text-muted">{r.old}</s>{' '}
                </>
              )}
              <span className={r.old !== r.now ? 'text-state-proposed-text' : undefined}>
                {r.now}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-1">
        <p className="text-meta font-bold text-muted">{t.whoAgreed}</p>
        <ul className="grid gap-0.5">
          {agreementRows(proposal, parties).map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-0.5">
              <span className="min-w-0 font-bold break-words">{row.name}</span>
              {row.agreed ? (
                <span className="flex shrink-0 items-center gap-1 font-bold text-state-confirmed-text">
                  <Check aria-hidden="true" className="size-4" />
                  {t.agreedMark}
                </span>
              ) : (
                <span className="shrink-0 font-bold text-state-pending-text">{t.waiting}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
      {(can.approve || can.reject || can.withdraw) && (
        <div className="flex flex-wrap gap-2">
          {can.approve && button('approve', t.approve, 'ok')}
          {can.reject && button('reject', t.reject, 'no')}
          {can.withdraw && button('withdraw', t.withdraw, 'ghost')}
        </div>
      )}
      {error && (
        <p role="alert" className="font-bold text-state-rejected-text">
          {error}
        </p>
      )}
    </Card>
  )
}

/**
 * The question before Nesouhlasím or Stáhnout návrh, both of which end the proposal. The
 * withdraw text names what stays: next week's default, or the default week as it is.
 */
export function ConfirmBody({
  kind,
  action,
  busy,
  onConfirm,
  onBack,
}: {
  kind: ProposalKind
  action: 'reject' | 'withdraw'
  busy: boolean
  onConfirm: () => void
  onBack: () => void
}) {
  const c = t.confirm[action]
  const body =
    action === 'withdraw' && kind === 'defaults' ? t.confirm.withdraw.bodyDefaults : c.body
  return (
    <>
      <DialogHeader>
        <DialogTitle>{c.title}</DialogTitle>
        <DialogDescription>{body}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onBack}>
          {t.confirm.back}
        </Button>
        <Button
          type="button"
          variant={action === 'reject' ? 'no' : 'primary'}
          disabled={busy}
          aria-busy={busy}
          onClick={onConfirm}
        >
          {busy ? t.sending : c.yes}
        </Button>
      </DialogFooter>
    </>
  )
}
