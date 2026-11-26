import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '~/components/ui/drawer'
import { cs } from '~/lib/strings'
import { scoreChangeErrorMessage } from '~/lib/taskErrors'
import {
  approveTaskScoreChangeFn,
  declineTaskScoreChangeFn,
  proposeTaskScoreChangeFn,
  type TaskView,
} from '~/server/tasks/functions'
import { ScoreStepper } from './ScoreStepper'
import type { Me } from './taskView'
import { canProposeChange, changeAnswer, changeHint } from './taskView'
import { useTaskAction } from './useTaskAction'

type Run = ReturnType<typeof useTaskAction>['run']

const errors = { errorMessage: scoreChangeErrorMessage }

/**
 * A new price for an agreed one-time task (#36, spec §5.2; mockups GTask and TApprove "Změna
 * ceny"). With a proposal in flight: the old and new score, who agreed, who it waits for, and
 * Souhlasím / Nesouhlasím for those people or Stáhnout návrh for the proposer (Jakub
 * 2026-11-21). Without one: "Změnit cenu" for those who may propose, which opens a drawer.
 */
export function ScoreChangePanel({
  task,
  me,
  rebid = false,
}: {
  task: TaskView
  me: Me
  /** The `reopenBidding` switch (#212): no "Změnit cenu" on an open task. */
  rebid?: boolean
}) {
  const { busy, run } = useTaskAction()
  const [open, setOpen] = useState(false)
  if (task.scoreChange) return <PendingChange task={task} me={me} busy={busy} run={run} />
  if (!canProposeChange(task, me, rebid)) return null
  return (
    <>
      <Button
        variant="ghost"
        className="h-auto min-h-tap w-full justify-start gap-3 px-3.5 py-2 text-left whitespace-normal"
        onClick={() => {
          setOpen(true)
        }}
      >
        <Pencil aria-hidden="true" />
        <span className="grid">
          <span>{cs.taskPrice.change}</span>
          <span className="font-body text-meta font-bold text-muted">{changeHint(task, me)}</span>
        </span>
      </Button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{cs.taskPrice.change}</DrawerTitle>
            <DrawerDescription>{cs.taskPrice.drawerText(task.score)}</DrawerDescription>
          </DrawerHeader>
          <ProposeForm
            task={task}
            busy={busy}
            run={run}
            onDone={() => {
              setOpen(false)
            }}
          />
        </DrawerContent>
      </Drawer>
    </>
  )
}

/** The drawer's body: − / + from the current score, and "Navrhnout N b". */
export function ProposeForm({
  task,
  busy,
  run,
  onDone,
  start = task.score,
}: {
  task: Pick<TaskView, 'id' | 'score'>
  busy: string | null
  run: Run
  onDone: () => void
  /** Where the stepper starts (the current score; tests start elsewhere). */
  start?: number
}) {
  const [score, setScore] = useState(start)
  const key = `price-${String(task.id)}`
  return (
    <div className="grid gap-3 px-4 pb-6">
      <ScoreStepper value={score} onChange={setScore} label={cs.tasks.score} />
      <Button
        disabled={busy !== null || score === task.score}
        aria-busy={busy === key}
        className="w-full"
        onClick={() => {
          void run(
            key,
            () => proposeTaskScoreChangeFn({ data: { taskId: task.id, score } }),
            () => cs.taskPrice.toast.proposed,
            errors,
          ).then((ok) => {
            if (ok) onDone()
          })
        }}
      >
        {cs.taskPrice.send(score)}
      </Button>
      <Button variant="ghost" className="w-full" onClick={onDone}>
        {cs.work.back}
      </Button>
    </div>
  )
}

function names(people: readonly { id: number; name: string }[], me: Me, sep: string): string {
  return people.map((p) => (p.id === me.id ? cs.bids.youAcc : p.name)).join(sep)
}

function PendingChange({
  task,
  me,
  busy,
  run,
}: {
  task: TaskView
  me: Me
  busy: string | null
  run: Run
}) {
  const change = task.scoreChange
  if (!change) return null
  const answer = changeAnswer(task, me)
  const data = { taskId: task.id, changeId: change.id }
  const yesKey = `price-yes-${String(change.id)}`
  const noKey = `price-no-${String(change.id)}`
  const no = (
    <Button
      variant="ghost"
      disabled={busy !== null}
      aria-busy={busy === noKey}
      className="w-full"
      onClick={() => {
        void run(
          noKey,
          () => declineTaskScoreChangeFn({ data }),
          () =>
            answer === 'withdraw' ? cs.taskPrice.toast.withdrawn : cs.taskPrice.toast.declined,
          errors,
        )
      }}
    >
      {answer === 'withdraw' ? cs.taskPrice.withdraw : cs.taskPrice.disagree}
    </Button>
  )
  return (
    <Card className="grid gap-2 bg-state-proposed/15">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">{cs.taskPrice.pending}</span>
        <span>
          <span className="num text-meta text-ink line-through">{task.score} b</span>{' '}
          <span className="num text-title font-bold text-state-proposed-text">
            {change.score} b
          </span>
        </span>
      </div>
      <p className="text-meta text-ink">
        {cs.bids.agreed}:{' '}
        {change.approvedBy.map((p) => `${p.id === me.id ? cs.bids.you : p.name} ✓`).join(', ')}
        {change.waitingFor.length > 0 && (
          <>
            <br />
            {cs.bids.waitingFor}: {names(change.waitingFor, me, ` ${cs.bids.or} `)}
          </>
        )}
        <br />
        {cs.taskPrice.oldStays(task.score)}
      </p>
      {answer === 'answer' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {no}
            <Button
              variant="ok"
              disabled={busy !== null}
              aria-busy={busy === yesKey}
              className="w-full"
              onClick={() => {
                void run(
                  yesKey,
                  () => approveTaskScoreChangeFn({ data }),
                  () => cs.taskPrice.toast.approved,
                  errors,
                )
              }}
            >
              {cs.taskPrice.agree}
            </Button>
          </div>
          <p className="text-meta text-ink">{cs.taskPrice.disagreeHint(task.score)}</p>
        </>
      )}
      {answer === 'withdraw' && (
        <>
          {no}
          <p className="text-meta text-ink">{cs.taskPrice.withdrawHint(task.score)}</p>
        </>
      )}
    </Card>
  )
}
