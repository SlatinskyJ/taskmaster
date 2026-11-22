import { Link, useRouter } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { dayTime, weekLabel } from '~/components/period/periodView'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import type { PeriodDefaults } from '~/domain'
import { cs } from '~/lib/strings'
import type { ProposalView, ProposalsView, SpanView } from '~/server/periods/functions'
import { NextWeekForm } from './NextWeekForm'
import { attempt, callProposalAction, proposeNextWeek } from './proposalCalls'
import type { ProposalAction } from './proposalCalls'
import { busyKey, ProposalCard } from './ProposalCard'
import type { ChangeRow } from './ProposalCard'
import { initialNextWeek, lengthInDays } from './proposalView'
import type { NextWeekForm as Form, ProposalKind } from './proposalView'

const t = cs.proposals
const weekdayNames = cs.admin.defaults.weekdayNames
const pad = (n: number) => String(n).padStart(2, '0')

export interface Me {
  id: number
  role: 'taker' | 'giver'
}

/** Where an error line shows: under a card or under the form. */
export type ErrorAt = { at: ProposalKind | 'form'; text: string } | null

/** Next week's proposal against the default week the server would start (`defaultNext`). */
export function periodRows(
  p: ProposalView<{ cutoffAt: string; levels: { lower: number; upper: number } }>,
  defaultNext: SpanView,
): ChangeRow[] {
  const start = new Date(defaultNext.startsAt)
  const s = p.settings
  return [
    { label: t.end, old: dayTime(defaultNext.cutoffAt), now: dayTime(s.cutoffAt) },
    {
      label: t.length,
      old: t.days(lengthInDays(start, new Date(defaultNext.cutoffAt))),
      now: t.days(lengthInDays(start, new Date(s.cutoffAt))),
    },
    { label: t.lower, old: String(defaultNext.levels.lower), now: String(s.levels.lower) },
    { label: t.upper, old: String(defaultNext.levels.upper), now: String(s.levels.upper) },
  ]
}

const weekdayTime = (d: PeriodDefaults) =>
  t.weekdayTime(weekdayNames[d.cutoff.weekday], `${pad(d.cutoff.hour)}:${pad(d.cutoff.minute)}`)

/** A default-week proposal against the stored default week. */
export function defaultsRows(
  p: ProposalView<PeriodDefaults>,
  current: PeriodDefaults,
): ChangeRow[] {
  const s = p.settings
  return [
    { label: t.length, old: t.days(current.lengthDays), now: t.days(s.lengthDays) },
    { label: t.end, old: weekdayTime(current), now: weekdayTime(s) },
    { label: t.lower, old: String(current.levels.lower), now: String(s.levels.lower) },
    { label: t.upper, old: String(current.levels.upper), now: String(s.levels.upper) },
  ]
}

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
                nextStartsAt={new Date(next.startsAt)}
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
                    lengthInDays(new Date(defaultNext.startsAt), new Date(defaultNext.cutoffAt)),
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

/** The question before Nesouhlasím or Stáhnout návrh, both of which end the proposal. */
export function ConfirmBody({
  action,
  busy,
  onConfirm,
  onBack,
}: {
  action: 'reject' | 'withdraw'
  busy: boolean
  onConfirm: () => void
  onBack: () => void
}) {
  const c = t.confirm[action]
  return (
    <>
      <DialogHeader>
        <DialogTitle>{c.title}</DialogTitle>
        <DialogDescription>{c.body}</DialogDescription>
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

/** The screen's state: the form, the running call, the error line and the open question. */
export function NextWeekScreen({ view, me }: { view: ProposalsView; me: Me }) {
  const router = useRouter()
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<ErrorAt>(null)
  const [ask, setAsk] = useState<{ kind: ProposalKind; action: 'reject' | 'withdraw' } | null>(null)

  async function act(kind: ProposalKind, action: ProposalAction) {
    const p = view[kind]
    if (!p) return
    setBusy(busyKey(kind, action))
    setError(null)
    const failed = await attempt(() => callProposalAction(action, kind, p.id))
    setBusy(null)
    setAsk(null)
    if (failed) {
      setError({ at: kind, text: failed })
      return
    }
    toast.success(t.done[action])
    await router.invalidate()
  }

  async function submit() {
    if (!form || !view.next) return
    const startsAt = new Date(view.next.startsAt)
    setBusy('propose')
    setError(null)
    const failed = await attempt(() => proposeNextWeek(startsAt, form))
    setBusy(null)
    if (failed) {
      setError({ at: 'form', text: failed })
      return
    }
    toast.success(t.sent)
    setForm(null)
    await router.invalidate()
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
          if (action === 'approve') void act(kind, action)
          else setAsk({ kind, action })
        }}
        onOpenForm={() => {
          if (view.next) {
            const n = view.next
            setForm(
              initialNextWeek({
                startsAt: new Date(n.startsAt),
                cutoffAt: new Date(n.cutoffAt),
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
