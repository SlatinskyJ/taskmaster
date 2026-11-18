import { useState } from 'react'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import type { TaskView } from '~/server/tasks/functions'
import { callBid } from './bidCalls'
import { ScoreStepper } from './ScoreStepper'
import type { BidCall, Me } from './taskView'
import { bidButtons, myBid, sendButton, toastFor } from './taskView'
import { useTaskAction } from './useTaskAction'

/**
 * What a person can do on a proposed task's page (spec §5.2): the yes buttons, each with its
 * outcome right under it (no dialog: the hint says what happens), then a new number on the
 * stepper. A brother bids; a parent makes a new offer, or on a brother's number accepts it.
 * Renders nothing once the task is agreed.
 */
export function BidPanel({ task, me }: { task: TaskView; me: Me }) {
  const { busy, run } = useTaskAction()
  const mine = myBid(task, me)
  const [value, setValue] = useState(mine ?? task.score)
  const yes = bidButtons(task, me)
  const send = sendButton(task, me, value)
  if (yes.length === 0 && !send) return null

  function tap(key: string, call: BidCall) {
    void run(
      key,
      () => callBid(call),
      (r) => toastFor(call.action, r.status, me),
    )
  }

  return (
    <div className="grid gap-4">
      {yes.length > 0 && (
        <div className="grid gap-3">
          {yes.map((b) => (
            <div key={b.key} className="grid gap-1">
              <Button
                variant={b.variant}
                disabled={busy !== null}
                aria-busy={busy === b.key}
                className="w-full"
                onClick={() => {
                  tap(b.key, b)
                }}
              >
                {busy === b.key ? cs.tasks.approving : b.label}
              </Button>
              <p className="text-meta text-muted">{b.hint}</p>
            </div>
          ))}
        </div>
      )}
      {mine !== null && (
        <p className="text-meta text-muted">{`${cs.bids.yourBid} ${String(mine)}`}</p>
      )}
      {send && (
        <section className="grid gap-2" aria-labelledby="bid-new-label">
          <SectionLabel id="bid-new-label">
            {me.role === 'taker' ? cs.bids.otherPrice : cs.bids.newOffer}
          </SectionLabel>
          <ScoreStepper value={value} onChange={setValue} label={cs.tasks.score} />
          {/* Own full-width line: a long "Přijmout 999 (name)" wraps here, never beside the
              stepper (360 px). */}
          <Button
            variant="primary"
            disabled={busy !== null || send.disabled}
            aria-busy={busy === 'send'}
            className="h-auto w-full py-2 break-words whitespace-normal"
            onClick={() => {
              tap('send', send)
            }}
          >
            {busy === 'send' ? cs.tasks.approving : send.label}
          </Button>
          <p className="text-meta text-muted">{send.hint}</p>
        </section>
      )}
    </div>
  )
}
