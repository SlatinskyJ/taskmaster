import { Minus, Plus } from 'lucide-react'
import { useId } from 'react'
import { dayTime } from '~/components/period/periodView'
import { sectionLabelClass } from '~/components/shell/SectionLabel'
import { ScoreStepper } from '~/components/tasks/ScoreStepper'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { MAX_LENGTH_DAYS } from '~/domain/periods'
import { LEVEL_MAX } from '~/lib/periodLimits'
import { cs } from '~/lib/strings'
import { fromTime, setLower, setUpper, toTime } from '../admin/defaultWeekForm'
import { nextWeekCutoff, stepDays, withinCap } from './proposalView'
import type { NextWeekForm as Form } from './proposalView'

const t = cs.proposals
const more = cs.admin.defaults

export interface NextWeekFormProps {
  /** The server's `next.startsAt`: every date here counts from it. */
  nextStartsAt: Date
  form: Form
  busy: boolean
  error: string | null
  onChange: (f: Form) => void
  onSubmit: () => void
  onCancel: () => void
}

/**
 * "Navrhnout jinak" (UI doc §7.2 Period): length in days, end time and levels for next week, no
 * typing for numbers (UI doc §5). A live "Konec: …" line shows the end before sending. Pure.
 */
export function NextWeekForm({
  nextStartsAt,
  form,
  busy,
  error,
  onChange,
  onSubmit,
  onCancel,
}: NextWeekFormProps) {
  const id = useId()
  const ok = withinCap(nextStartsAt, form)
  return (
    <Card className="grid gap-4">
      <div className="grid gap-2" role="group" aria-labelledby={`${id}-length`}>
        <span id={`${id}-length`} className={sectionLabelClass}>
          {t.length}
        </span>
        <div className="flex items-center gap-2.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t.shorter}
            disabled={form.lengthDays <= 1}
            onClick={() => {
              onChange(stepDays(form, -1))
            }}
          >
            <Minus aria-hidden="true" />
          </Button>
          <output aria-live="polite" className="flex-1 text-center num text-xl">
            {t.days(form.lengthDays)}
          </output>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t.longer}
            disabled={form.lengthDays >= MAX_LENGTH_DAYS}
            onClick={() => {
              onChange(stepDays(form, 1))
            }}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </div>
      <label className="grid gap-2">
        <span className={sectionLabelClass}>{more.time}</span>
        <Input
          type="time"
          value={toTime(form.hour, form.minute)}
          onChange={(e) => {
            const time = fromTime(e.target.value)
            if (time) onChange({ ...form, ...time })
          }}
        />
      </label>
      <p aria-live="polite" className="num font-bold">
        {t.endLine(dayTime(nextWeekCutoff(nextStartsAt, form).toISOString()))}
      </p>
      <div className="grid gap-2" role="group" aria-labelledby={`${id}-lower`}>
        <span id={`${id}-lower`} className={sectionLabelClass}>
          {t.lower}
        </span>
        <ScoreStepper
          value={form.levels.lower}
          min={1}
          max={LEVEL_MAX}
          label={t.lower}
          lessLabel={more.less(t.lower)}
          moreLabel={more.more(t.lower)}
          onChange={(n) => {
            onChange(setLower(form, n))
          }}
        />
      </div>
      <div className="grid gap-2" role="group" aria-labelledby={`${id}-upper`}>
        <span id={`${id}-upper`} className={sectionLabelClass}>
          {t.upper}
        </span>
        <ScoreStepper
          value={form.levels.upper}
          min={form.levels.lower}
          max={LEVEL_MAX}
          label={t.upper}
          lessLabel={more.less(t.upper)}
          moreLabel={more.more(t.upper)}
          onChange={(n) => {
            onChange(setUpper(form, n))
          }}
        />
      </div>
      {!ok && (
        <p role="alert" className="font-bold text-state-rejected-text">
          {t.tooLong}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" className="flex-1" disabled={busy} onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={busy || !ok}
          aria-busy={busy}
          onClick={onSubmit}
        >
          {busy ? t.sending : t.proposeAll}
        </Button>
      </div>
      {error && (
        <p role="alert" className="font-bold text-state-rejected-text">
          {error}
        </p>
      )}
    </Card>
  )
}
