import { Minus, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { SectionLabel, sectionLabelClass } from '~/components/shell/SectionLabel'
import { ScoreStepper } from '~/components/tasks/ScoreStepper'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import type { PeriodDefaults } from '~/domain'
import type { Weekday } from '~/domain/dates'
import { LEVEL_MAX } from '~/lib/periodLimits'
import { cs } from '~/lib/strings'
import {
  canLengthen,
  canShorten,
  fromTime,
  sameDefaults,
  setLower,
  setUpper,
  stepLength,
  toTime,
  WEEKDAY_ORDER,
} from './defaultWeekForm'

const t = cs.admin.defaults
const levelLabel = cs.meeting.level

export interface DefaultWeekViewProps {
  /** What is stored now. */
  saved: PeriodDefaults
  /** What the form shows. */
  form: PeriodDefaults
  busy: boolean
  error: string | null
  onChange: (next: PeriodDefaults) => void
  onSave: () => void
}

/**
 * Výchozí týden on Správa (UI doc §7.5 ASettings, spec §5.8): length in weeks, end weekday and
 * time, lower and upper level. Each label sits above its control; no typing for numbers (UI
 * doc §5). Pure: the state lives in `DefaultWeekCard`.
 */
export function DefaultWeekView({
  saved,
  form,
  busy,
  error,
  onChange,
  onSave,
}: DefaultWeekViewProps) {
  const id = useId()
  const unchanged = sameDefaults(form, saved)
  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-2">
      <SectionLabel id={`${id}-title`}>{t.title}</SectionLabel>
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
              disabled={!canShorten(form)}
              onClick={() => {
                onChange(stepLength(form, -1))
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
              disabled={!canLengthen(form)}
              onClick={() => {
                onChange(stepLength(form, 1))
              }}
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="grid gap-2" role="group" aria-labelledby={`${id}-cutoff`}>
          <span id={`${id}-cutoff`} className={sectionLabelClass}>
            {t.cutoff}
          </span>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={String(form.cutoff.weekday)}
              onValueChange={(v) => {
                onChange({ ...form, cutoff: { ...form.cutoff, weekday: Number(v) as Weekday } })
              }}
            >
              <SelectTrigger aria-label={t.weekday} className="min-h-tap">
                <SelectValue>{t.weekdayNames[form.cutoff.weekday]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {WEEKDAY_ORDER.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {t.weekdayNames[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="time"
              aria-label={t.time}
              value={toTime(form.cutoff.hour, form.cutoff.minute)}
              onChange={(e) => {
                const time = fromTime(e.target.value)
                if (time) onChange({ ...form, cutoff: { ...form.cutoff, ...time } })
              }}
            />
          </div>
        </div>

        <div className="grid gap-2" role="group" aria-labelledby={`${id}-lower`}>
          <span id={`${id}-lower`} className={sectionLabelClass}>
            {levelLabel.lower}
          </span>
          <ScoreStepper
            value={form.levels.lower}
            min={1}
            max={LEVEL_MAX}
            label={levelLabel.lower}
            lessLabel={t.less(levelLabel.lower)}
            moreLabel={t.more(levelLabel.lower)}
            onChange={(n) => {
              onChange(setLower(form, n))
            }}
          />
        </div>

        <div className="grid gap-2" role="group" aria-labelledby={`${id}-upper`}>
          <span id={`${id}-upper`} className={sectionLabelClass}>
            {levelLabel.upper}
          </span>
          <ScoreStepper
            value={form.levels.upper}
            min={form.levels.lower}
            max={LEVEL_MAX}
            label={levelLabel.upper}
            lessLabel={t.less(levelLabel.upper)}
            moreLabel={t.more(levelLabel.upper)}
            onChange={(n) => {
              onChange(setUpper(form, n))
            }}
          />
        </div>

        <p className="text-meta font-bold text-muted">{t.hint}</p>
        <Button size="lg" className="w-full" disabled={unchanged || busy} onClick={onSave}>
          {busy ? cs.admin.saving : cs.admin.save}
        </Button>
        {error && (
          <p role="alert" className="font-bold text-state-rejected-text">
            {error}
          </p>
        )}
      </Card>
    </section>
  )
}

/** Czech message for a refused save (codes from src/server/periods). */
export function defaultsErrorMessage(error: string): string {
  if (error === 'invalid_settings') return t.invalidSettings
  if (error === 'not_admin') return cs.admin.errors.notAdmin
  return t.failed
}

/**
 * The card with its state. `onSave` sends the form and resolves to an error code, or null when
 * saved; a thrown error (network) shows the generic text. The form keeps its values on failure,
 * so Uložit is the retry.
 */
export function DefaultWeekCard({
  defaults,
  onSave,
}: {
  defaults: PeriodDefaults
  onSave: (d: PeriodDefaults) => Promise<string | null>
}) {
  const [form, setForm] = useState(defaults)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const refused = await onSave(form)
      if (refused) setError(defaultsErrorMessage(refused))
    } catch {
      setError(t.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DefaultWeekView
      saved={defaults}
      form={form}
      busy={busy}
      error={error}
      onChange={(next) => {
        setError(null)
        setForm(next)
      }}
      onSave={() => {
        void save()
      }}
    />
  )
}
