import { useState } from 'react'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { ScoreStepper } from '~/components/tasks/ScoreStepper'
import type { Me } from '~/components/tasks/taskView'
import { useTaskAction } from '~/components/tasks/useTaskAction'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import type { TemplateView } from '~/server/templates/functions'
import { callPrice } from './priceCalls'
import type { PriceCall } from './priceView'
import {
  myTemplateBid,
  priceButtons,
  priceError,
  priceRefusal,
  priceSend,
  priceToast,
  stepperStart,
} from './priceView'

/**
 * What a person can do about an agreed template's score (spec §5.1), like BidPanel for a task:
 * the yes button with its outcome right under it, then a new number on the stepper. A brother
 * bids; a parent makes a new offer, or at the lowest bid accepts it. On a proposed chore with
 * first-price bidding (#209) the same, plus a no button (Nechci / Odmítnout nabídky) like a Návrh;
 * on an agreed chore's price change that no button only with `refusals` (switch `bidRefusals`, #232).
 */
export function TemplatePricePanel({
  template,
  me,
  refusals = false,
}: {
  template: TemplateView
  me: Me
  refusals?: boolean
}) {
  const { busy, run } = useTaskAction()
  const mine = myTemplateBid(template, me)
  const [value, setValue] = useState(stepperStart(template, me))
  const refusal = priceRefusal(template, me, refusals)
  const yes = refusal ? [...priceButtons(template, me), refusal] : priceButtons(template, me)
  const proposed = template.status === 'proposed'
  const send = priceSend(template, me, value)
  if (!send) return null

  function tap(key: string, call: PriceCall) {
    void run(
      key,
      () => callPrice(call),
      (r) => priceToast(call, r, proposed),
      { errorMessage: priceError(call) },
    )
  }

  return (
    <div className="grid gap-4">
      {yes.map((b) => (
        <div key={b.key} className="grid gap-1">
          <Button
            variant={b === refusal ? 'ghost' : 'ok'}
            disabled={busy !== null}
            aria-busy={busy === b.key}
            className="h-auto w-full py-2 break-words whitespace-normal"
            onClick={() => {
              tap(b.key, b)
            }}
          >
            {busy === b.key ? cs.tasks.approving : b.label}
          </Button>
          <p className="text-meta text-muted">{b.hint}</p>
        </div>
      ))}
      {mine !== null && (
        <p className="text-meta text-muted">{`${cs.bids.yourBid} ${String(mine)}`}</p>
      )}
      <section className="grid gap-2" aria-labelledby="price-new-label">
        <SectionLabel id="price-new-label">
          {me.role === 'taker' ? cs.bids.otherPrice : cs.bids.newOffer}
        </SectionLabel>
        <ScoreStepper value={value} onChange={setValue} label={cs.tasks.score} />
        {/* Own full-width line: a long "Přijmout 99 (Starší, Mladší)" wraps here (360 px). */}
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
    </div>
  )
}
