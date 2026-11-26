import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import type { Me } from '~/components/tasks/taskView'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { answerDescriptionFn, changeDescriptionFn } from '~/server/descriptions/functions'
import type {
  DescriptionOutcome,
  DescriptionTarget,
  WaitingDescription as Waiting,
} from '~/server/descriptions/functions'
import { answerDescription, descriptionToast, takeBackDescription } from './descriptionCalls'
import type { DescriptionCallResult } from './descriptionCalls'

type Busy = 'yes' | 'no' | 'back' | null

// A waiting description change (#207, spec §5.2): the new text, who it waits for, and the buttons
// of whoever answers it: a brother it waits for says yes or no, a parent takes it back (ruling 7).
export function WaitingDescription({
  change,
  target,
  inForce,
  me,
}: {
  change: Waiting
  target: DescriptionTarget
  /** The text in force now; sending it back withdraws the change. */
  inForce: string | null
  me: Me
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<Busy>(null)

  async function run(
    which: Exclude<Busy, null>,
    call: () => Promise<DescriptionCallResult<DescriptionOutcome>>,
  ) {
    setBusy(which)
    const r = await call()
    setBusy(null)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    toast.success(descriptionToast(r.outcome))
    void router.invalidate()
  }

  return (
    <WaitingCard
      change={change}
      me={me}
      busy={busy}
      onAnswer={(yes) =>
        void run(yes ? 'yes' : 'no', () =>
          answerDescription(target, change.id, yes, answerDescriptionFn),
        )
      }
      onTakeBack={() =>
        void run('back', () => takeBackDescription(target, inForce, changeDescriptionFn))
      }
    />
  )
}

/** The card itself, hook-free so each state renders in a test. */
export function WaitingCard({
  change,
  me,
  busy,
  onAnswer,
  onTakeBack,
}: {
  change: Waiting
  me: Me
  busy: Busy
  onAnswer: (yes: boolean) => void
  onTakeBack: () => void
}) {
  const answers = me.role === 'taker' && change.waitingFor.includes(me.id)
  const takesBack = me.role === 'giver'
  return (
    <div
      data-slot="description-change"
      className="grid gap-2 rounded-button border-2 border-state-negotiating bg-surface px-3 py-2"
    >
      <span className="text-meta font-bold">{cs.description.waitingTitle}</span>
      {change.description === null ? (
        <p className="text-meta text-muted">{cs.description.waitingRemove}</p>
      ) : (
        <p className="break-words whitespace-pre-line">{change.description}</p>
      )}
      {change.waitingForNames.length > 0 && (
        <p className="text-meta text-muted">
          {cs.description.waitingFor(change.waitingForNames.join(', '))}
        </p>
      )}
      {(answers || takesBack) && (
        <div className="flex flex-wrap gap-2">
          {answers && (
            <>
              <Button
                type="button"
                variant="ok"
                disabled={busy !== null}
                aria-busy={busy === 'yes'}
                onClick={() => {
                  onAnswer(true)
                }}
              >
                {cs.description.agree}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy !== null}
                aria-busy={busy === 'no'}
                onClick={() => {
                  onAnswer(false)
                }}
              >
                {cs.description.decline}
              </Button>
            </>
          )}
          {takesBack && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy !== null}
              aria-busy={busy === 'back'}
              onClick={onTakeBack}
            >
              {cs.description.takeBack}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
