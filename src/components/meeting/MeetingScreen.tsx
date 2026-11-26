import { Link, useRouter } from '@tanstack/react-router'
import { useMemo, useReducer } from 'react'
import { toast } from 'sonner'
import { EmptyState } from '~/components/EmptyState'
import { PointsBar } from '~/components/points/PointsBar'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { lowestText, taskChipState } from '~/components/tasks/taskView'
import { TaskRow } from '~/components/tasks/TaskRow'
import { ToApprove } from '~/components/tasks/ToApprove'
import { Button, buttonVariants } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { cn } from '~/lib/utils'
import { settlePeriodFn, type Meeting, type MeetingTaker } from '~/server/settlement/functions'
import type { TaskView } from '~/server/tasks/functions'
import {
  afterConfirm,
  createConfirm,
  reduce,
  START,
  startingTotals,
  stepOf,
  type MeetingEvent,
  type MeetingStep,
  type MeetingUi,
} from './meetingFlow'
import { dayTime, levelBadgeClass, levelLabel, weekLabel } from '~/components/period/periodView'
import { shortfall, untilLabel } from './meetingView'

type Week = Extract<Meeting, { period: object }>

/**
 * The weekly meeting (spec §5.9, UI doc §7.3 M1Pending, M2Settle, M3Plan), giver only.
 * State lives in `meetingFlow.ts`; this file renders it. See PR #175 rulings for the
 * second-tap confirm, staying on step 3 after a confirm, and the refusal toasts.
 */
export function MeetingScreen({
  meeting,
  plan,
  otherLevels = false,
}: {
  meeting: Meeting
  plan: readonly TaskView[]
  /** The `periodProposals` switch: step 3 links to Příští týden ("Jiné hranice", #43). */
  otherLevels?: boolean
}) {
  const router = useRouter()
  const [ui, dispatch] = useReducer(reduce, START)
  const confirm = useMemo(
    () =>
      createConfirm(
        (request) => settlePeriodFn(request),
        dispatch,
        (result) =>
          afterConfirm(result, {
            success: (text) => toast.success(text),
            error: (text) => toast.error(text),
            reload: () => router.invalidate(),
          }),
      ),
    [router],
  )
  return (
    <MeetingBody
      meeting={meeting}
      plan={plan}
      ui={ui}
      dispatch={dispatch}
      onConfirm={() => void confirm(meeting)}
      otherLevels={otherLevels}
    />
  )
}

/** The screen for one state; no hooks, so every state renders in a test. */
export function MeetingBody({
  meeting,
  plan,
  ui,
  dispatch,
  onConfirm,
  otherLevels = false,
}: {
  meeting: Meeting
  plan: readonly TaskView[]
  ui: MeetingUi
  dispatch: (event: MeetingEvent) => void
  onConfirm: () => void
  otherLevels?: boolean
}) {
  const step = stepOf(meeting, ui)
  return (
    <div className="grid gap-4 px-4 pb-6">
      {/* Nothing settled: the earlier steps are not shown as done. */}
      <Steps step={step} skipped={step === 3 && !ui.result} />
      {meeting.period && !ui.result && (
        <p className="text-meta font-bold text-muted">
          {weekLabel(
            meeting.period.startsAt,
            meeting.period.running ? meeting.period.cutoffAt : meeting.period.endsAt,
          )}{' '}
          · {cs.meeting.levelsLabel} {meeting.period.levels.lower} / {meeting.period.levels.upper}
        </p>
      )}
      {step === 1 && meeting.period && (
        <StepApprove
          meeting={meeting}
          onNext={() => {
            dispatch({ type: 'next', periodId: meeting.period.id })
          }}
        />
      )}
      {step === 2 && meeting.period && (
        <StepSettle meeting={meeting} ui={ui} dispatch={dispatch} onConfirm={onConfirm} />
      )}
      {step === 3 && (
        <StepPlan
          ui={ui}
          plan={plan}
          nothing={!ui.result}
          runningCutoffAt={meeting.period ? null : meeting.runningCutoffAt}
          otherLevels={otherLevels}
        />
      )}
    </div>
  )
}

function Steps({ step, skipped }: { step: MeetingStep; skipped: boolean }) {
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label={cs.nav.meeting}>
      {cs.meeting.steps.map((label, i) => {
        const n = i + 1
        const state = n === step ? 'current' : n < step && !skipped ? 'done' : 'todo'
        return (
          <li
            key={label}
            data-step={state}
            aria-current={state === 'current' ? 'step' : undefined}
            className="grid gap-1 text-center text-meta font-bold"
          >
            <span
              aria-hidden
              className={cn(
                'h-1.5 rounded-full',
                state === 'done' && 'bg-ok',
                state === 'current' && 'bg-primary',
                state === 'todo' && 'bg-border',
              )}
            />
            <span className={state === 'todo' ? 'text-muted' : undefined}>{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function StepApprove({ meeting, onNext }: { meeting: Week; onNext: () => void }) {
  const left = meeting.pending.length
  return (
    <section className="grid gap-3">
      {left > 0 ? (
        <>
          <p className="text-meta text-muted">
            {cs.meeting.pendingHint(untilLabel(meeting.period.endsAt))}
          </p>
          <ToApprove items={meeting.pending} />
        </>
      ) : (
        <div className="grid gap-1 rounded-card bg-surface p-4 text-center shadow-sticker">
          <p className="text-row font-bold">{cs.meeting.allClear}</p>
          <p className="text-meta text-muted">{cs.meeting.allClearHint}</p>
        </div>
      )}
      <Button size="lg" disabled={left > 0} onClick={onNext}>
        {left > 0 ? cs.meeting.left(left) : cs.meeting.next}
      </Button>
    </section>
  )
}

function TakerCard({ taker, lower, upper }: { taker: MeetingTaker; lower: number; upper: number }) {
  const line = shortfall(taker.total, lower)
  return (
    <li data-taker={taker.id} className="grid gap-3 rounded-card bg-surface p-4 shadow-sticker">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-row font-bold break-words">{taker.name}</span>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-chip font-bold',
            levelBadgeClass(taker.level),
          )}
        >
          {levelLabel(taker.level)}
        </span>
      </div>
      <PointsBar confirmed={taker.total} pending={0} lower={lower} upper={upper} />
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-meta text-muted">{cs.meeting.total}</dt>
          <dd className="num text-lg font-bold">{taker.total}</dd>
        </div>
        <div>
          <dt className="text-meta text-muted">{cs.meeting.deducted}</dt>
          <dd className={cn('num text-lg font-bold', taker.deducted > 0 && 'text-destructive')}>
            {taker.deducted > 0 ? `−${String(taker.deducted)}` : '0'}
          </dd>
        </div>
        <div>
          <dt className="text-meta text-muted">{cs.meeting.carry}</dt>
          <dd className="num text-lg font-bold text-ok">{taker.carryOver}</dd>
        </div>
      </dl>
      {line && <p className="text-meta text-muted">{line}</p>}
    </li>
  )
}

function StepSettle({
  meeting,
  ui,
  dispatch,
  onConfirm,
}: {
  meeting: Week
  ui: MeetingUi
  dispatch: (event: MeetingEvent) => void
  onConfirm: () => void
}) {
  const { lower, upper } = meeting.period.levels
  return (
    <section className="grid gap-3">
      <ul className="grid gap-3">
        {meeting.takers.map((t) => (
          <TakerCard key={t.id} taker={t} lower={lower} upper={upper} />
        ))}
      </ul>
      <p className="text-meta text-muted">{cs.meeting.final}</p>
      {ui.asking ? (
        <div
          role="alertdialog"
          aria-labelledby="settle-title"
          aria-describedby="settle-body"
          className="grid gap-3 rounded-card bg-surface p-4 shadow-sticker"
        >
          <p id="settle-title" className="text-row font-bold">
            {cs.meeting.confirmTitle}
          </p>
          <p id="settle-body" className="text-meta text-muted">
            {cs.meeting.confirmBody}
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              disabled={ui.busy}
              onClick={() => {
                dispatch({ type: 'back' })
              }}
            >
              {cs.meeting.confirmNo}
            </Button>
            <Button
              variant="ok"
              className="flex-1"
              disabled={ui.busy}
              aria-busy={ui.busy}
              onClick={onConfirm}
            >
              {cs.meeting.confirmYes}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="lg"
          onClick={() => {
            dispatch({ type: 'ask' })
          }}
        >
          {cs.meeting.confirm}
        </Button>
      )}
    </section>
  )
}

function planMeta(t: TaskView): string | undefined {
  if (t.status === 'reserved' && t.reservedBy) return `${cs.work.reservedBy} ${t.reservedBy.name}`
  return undefined
}

function StepPlan({
  ui,
  plan,
  nothing,
  runningCutoffAt,
  otherLevels,
}: {
  ui: MeetingUi
  plan: readonly TaskView[]
  nothing: boolean
  /** Set before the running week's last day (#211): the card says when the week ends. */
  runningCutoffAt: string | null
  otherLevels: boolean
}) {
  const result = ui.result
  const starting = startingTotals(ui)
  return (
    <section className="grid gap-3">
      {nothing && runningCutoffAt && (
        <div className="grid gap-1 rounded-card bg-surface p-4 text-center shadow-sticker">
          <p className="text-row font-bold">{cs.meeting.notYet}</p>
          <p className="text-meta font-bold break-words text-muted">
            {cs.meeting.runsUntil(untilLabel(runningCutoffAt))}
          </p>
          <p className="text-meta font-bold break-words text-muted">{cs.meeting.settleOnLastDay}</p>
        </div>
      )}
      {nothing && !runningCutoffAt && (
        <p className="rounded-card bg-surface p-4 text-center text-row font-bold shadow-sticker">
          {cs.meeting.nothing}
        </p>
      )}
      {result && (
        <div className="grid gap-2 rounded-card bg-surface p-4 shadow-sticker">
          <p className="text-meta font-bold text-ok">
            {cs.meeting.settledAt} · {dayTime(result.settledAt)}
          </p>
          {result.next ? (
            <div>
              <p className="text-row font-bold">
                {cs.meeting.newWeek} {weekLabel(result.next.startsAt, result.next.cutoffAt)}
              </p>
              <p className="text-meta font-bold text-muted">
                {cs.meeting.levelsLabel} {result.next.levels.lower} / {result.next.levels.upper}
              </p>
            </div>
          ) : (
            <p className="text-row font-bold">{cs.meeting.stillRunning}</p>
          )}
          {starting.length > 0 && (
            <div className="grid gap-1">
              <p className="text-meta text-muted">{cs.meeting.startWith}</p>
              <ul className="grid gap-1">
                {starting.map((s) => (
                  <li key={s.id} data-start={s.id} className="flex justify-between gap-2">
                    <span className="min-w-0 break-words">{s.name}</span>
                    <span className="num font-bold text-ok">{s.carryOver}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {otherLevels && (
        <Link to="/tyden/pristi" className={cn(buttonVariants({ variant: 'ghost' }), 'w-full')}>
          {cs.proposals.entry.otherLevels}
        </Link>
      )}
      <SectionLabel id="plan-label">{cs.meeting.planTasks}</SectionLabel>
      {plan.length === 0 ? (
        <EmptyState>{cs.meeting.planEmpty}</EmptyState>
      ) : (
        <ul className="grid gap-2" aria-labelledby="plan-label">
          {plan.map((t) => (
            <li key={t.id}>
              <Link to="/ukol/$taskId" params={{ taskId: String(t.id) }} className="block">
                <TaskRow
                  described={t.description !== null}
                  name={t.title}
                  state={taskChipState(t)}
                  points={t.score}
                  meta={planMeta(t)}
                  detail={t.lowest ? lowestText(t.lowest) : undefined}
                  action={
                    t.status === 'proposed' && t.bids.length > 0 ? (
                      <span className={buttonVariants({ variant: 'ghost' })}>{cs.bids.answer}</span>
                    ) : undefined
                  }
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2">
        {/* As M3Plan: adding a task is the side action, ending the meeting the main one. */}
        <Link to="/ukoly/novy" className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
          {cs.meeting.newTask}
        </Link>
        <Link to="/" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
          {cs.meeting.end}
        </Link>
      </div>
    </section>
  )
}
