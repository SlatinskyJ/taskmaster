import { Link, useRouter } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { dayTime, weekLabel } from '~/components/period/periodView'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Dialog, DialogContent } from '~/components/ui/dialog'
import { parseIsoUtc } from '~/domain/dates'
import { cs } from '~/lib/strings'
import type { ProposalsView } from '~/server/periods/functions'
import { NextWeekForm } from './NextWeekForm'
import { asksFirst, callProposalAction, proposeNextWeek, runProposalCall } from './proposalCalls'
import type { CallUi, ProposalAction } from './proposalCalls'
import { busyKey, ConfirmBody, ProposalCard } from './ProposalCard'
import { defaultsRows, periodRows } from './proposalRows'
import { initialNextWeek, lengthInDays } from './proposalView'
import type { NextWeekForm as Form, ProposalKind } from './proposalView'

const t = cs.proposals

export interface Me {
  id: number
  role: 'taker' | 'giver'
}

/** Where an error line shows: under a card or under the form. */
export type ErrorAt = { at: ProposalKind | 'form'; text: string } | null

export interface NextWeekViewProps {
  view: ProposalsView
  me: Me
  /** The open form's values, or null while it is closed. */
  form: Form | null
  busy: string | null
  error: ErrorAt
  onAct: (kind: ProposalKind, action: ProposalAction) => void
  onOpenForm: () => void
  onFormChange: (f: Form) => void
  onSubmit: () => void
  onCancelForm: () => void
}

/** Příští týden (UI doc §7.2 Period). Pure: the state lives in `NextWeekScreen`. */
export function NextWeekView({
  view,
  me,
  form,
  busy,
  error,
  onAct,
  onOpenForm,
  onFormChange,
  onSubmit,
  onCancelForm,
}: NextWeekViewProps) {
  const { running, next, defaultNext, period, defaults } = view
  const errorFor = (at: ProposalKind | 'form') => (error?.at === at ? error.text : null)
  return (
    <div className="grid gap-3.5">
      {running && next && defaultNext ? (
        <>
          <section className="grid gap-2">
            <SectionLabel>{t.thisWeek}</SectionLabel>
            <Card className="grid gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="num font-bold">
                  {weekLabel(running.startsAt, running.cutoffAt)}
                </span>
                <Badge>{t.locked}</Badge>
              </div>
              <p className="text-meta font-bold text-muted">
                {t.levels(running.levels.lower, running.levels.upper)}
              </p>
            </Card>
          </section>

          <section className="grid gap-2">
            <SectionLabel>{t.nextSection}</SectionLabel>
            {period ? (
              <ProposalCard
                kind="period"
                proposal={period}
                parties={view.parties}
                me={me.id}
                rows={periodRows(period, defaultNext)}
                validFrom={dayTime(next.startsAt)}
                busy={busy}
                error={errorFor('period')}
                onAct={(a) => {
                  onAct('period', a)
                }}
              />
            ) : form ? (
              <NextWeekForm
                nextStartsAt={parseIsoUtc(next.startsAt)}
                form={form}
                busy={busy === 'propose'}
                error={errorFor('form')}
                onChange={onFormChange}
                onSubmit={onSubmit}
                onCancel={onCancelForm}
              />
            ) : (
              <Button variant="ghost" className="w-full" onClick={onOpenForm}>
                {t.proposeOther}
              </Button>
            )}
            {period?.status !== 'agreed' && (
              <p className="text-meta font-bold text-muted">
                {t.note(
                  dayTime(next.startsAt),
                  t.days(
                    lengthInDays(
                      parseIsoUtc(defaultNext.startsAt),
                      parseIsoUtc(defaultNext.cutoffAt),
                    ),
                  ),
                  defaultNext.levels.lower,
                  defaultNext.levels.upper,
                )}
              </p>
            )}
          </section>
        </>
      ) : (
        <Card>
          <p className="font-bold text-muted">{t.noWeek}</p>
        </Card>
      )}

      {defaults && (
        <section className="grid gap-2">
          <SectionLabel>{t.defaultsSection}</SectionLabel>
          <ProposalCard
            kind="defaults"
            proposal={defaults}
            parties={view.parties}
            me={me.id}
            rows={defaultsRows(defaults, view.currentDefaults)}
            busy={busy}
            error={errorFor('defaults')}
            onAct={(a) => {
              onAct('defaults', a)
            }}
          />
        </section>
      )}

      {me.role === 'giver' && (
        <Link
          to="/tyden/vychozi"
          className="flex min-h-tap items-center justify-between rounded-card bg-surface px-4 font-extrabold shadow-sticker"
        >
          {t.defaultsLink}
          <ChevronRight aria-hidden="true" />
        </Link>
      )}
    </div>
  )
}

/** The screen's state: the form, the running call, the error line and the open question. */
export function NextWeekScreen({ view, me }: { view: ProposalsView; me: Me }) {
  const router = useRouter()
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<ErrorAt>(null)
  const [ask, setAsk] = useState<{ kind: ProposalKind; action: 'reject' | 'withdraw' } | null>(null)

  const ui = (at: ProposalKind | 'form'): CallUi => ({
    busy: setBusy,
    error: (text) => {
      setError(text ? { at, text } : null)
    },
    success: (text) => toast.success(text),
    reload: () => router.invalidate(),
  })

  async function act(kind: ProposalKind, action: ProposalAction) {
    const p = view[kind]
    if (!p) return
    await runProposalCall(
      busyKey(kind, action),
      () => callProposalAction(action, kind, p.id),
      t.done[action],
      ui(kind),
    )
    setAsk(null)
  }

  async function submit() {
    if (!form || !view.next) return
    const startsAt = parseIsoUtc(view.next.startsAt)
    if (
      await runProposalCall('propose', () => proposeNextWeek(startsAt, form), t.sent, ui('form'))
    ) {
      setForm(null)
    }
  }

  return (
    <>
      <NextWeekView
        view={view}
        me={me}
        form={form}
        busy={busy}
        error={error}
        onAct={(kind, action) => {
          if (asksFirst(action)) setAsk({ kind, action })
          else void act(kind, action)
        }}
        onOpenForm={() => {
          if (view.next) {
            const n = view.next
            setForm(
              initialNextWeek({
                startsAt: parseIsoUtc(n.startsAt),
                cutoffAt: parseIsoUtc(n.cutoffAt),
                levels: n.levels,
              }),
            )
          }
        }}
        onFormChange={(f) => {
          setError(null)
          setForm(f)
        }}
        onSubmit={() => {
          void submit()
        }}
        onCancelForm={() => {
          setForm(null)
          setError(null)
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
              kind={ask.kind}
              action={ask.action}
              busy={busy !== null}
              onConfirm={() => {
                void act(ask.kind, ask.action)
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
