import { Minus, Plus } from 'lucide-react'
import type { Weekday } from '~/domain/dates'
import { sectionLabelClass } from '~/components/shell/SectionLabel'
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
import { cs } from '~/lib/strings'
import { cn } from '~/lib/utils'
import type { RecurringValue } from './actions'
import { MAX_GRACE_HOURS } from './actions'

const t = cs.templates

/** Monday first, as Czech calendars show a week. */
const WEEK: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0]

const hintClass = 'text-meta font-bold text-muted'

/**
 * The recurring half of Nový úkol (UI doc §7.2 GCreate, spec §5.3): weekdays and an optional
 * time when instances appear, and an optional deadline rule (Jakub 2026-11-18: days after the
 * instance appears + a clock time, then a grace window).
 */
export function RecurringFields({
  value,
  onChange,
}: {
  value: RecurringValue
  onChange: (v: RecurringValue) => void
}) {
  const set = (change: Partial<RecurringValue>) => {
    onChange({ ...value, ...change })
  }
  const toggleDay = (d: Weekday) => {
    set({ days: value.days.includes(d) ? value.days.filter((x) => x !== d) : [...value.days, d] })
  }
  const hasDays = value.days.length > 0

  return (
    <Card className="grid gap-3">
      <div className="grid gap-2" role="group" aria-labelledby="when-label">
        <span id="when-label" className={sectionLabelClass}>
          {t.when}
        </span>
        {/* Seven 44 px buttons need 314 px; the card has 300 px inside at 360 px, so the row
            borrows 8 px of the card padding on each side. */}
        <div className="-mx-2 grid grid-cols-7 justify-items-center gap-px">
          {WEEK.map((d) => {
            const on = value.days.includes(d)
            return (
              <Button
                key={d}
                type="button"
                size="icon"
                variant={on ? 'primary' : 'ghost'}
                aria-pressed={on}
                className="size-tap rounded-full"
                onClick={() => {
                  toggleDay(d)
                }}
              >
                {t.days[d]}
              </Button>
            )
          })}
        </div>
        {hasDays ? (
          <>
            <label className="flex min-h-tap items-center gap-2.5 text-row font-extrabold">
              <input
                type="checkbox"
                checked={value.withTime}
                onChange={(e) => {
                  set({ withTime: e.target.checked })
                }}
                className="size-5.5 accent-accent-strong"
              />
              {t.withTime}
            </label>
            {value.withTime ? (
              <label className="grid gap-1">
                <span className={hintClass}>{t.atTime}</span>
                <Input
                  type="time"
                  required
                  value={value.time}
                  onChange={(e) => {
                    set({ time: e.target.value })
                  }}
                  className="font-bold"
                />
              </label>
            ) : (
              <p className={hintClass}>{t.noTimeHint}</p>
            )}
          </>
        ) : (
          <p className={hintClass}>{t.onDemandHint}</p>
        )}
      </div>

      <div className="grid gap-2" role="group" aria-labelledby="deadline-label">
        <span id="deadline-label" className={sectionLabelClass}>
          {t.deadline}
        </span>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              [false, t.noDeadline, t.noDeadlineHint],
              [true, t.withDeadline, t.withDeadlineHint],
            ] as const
          ).map(([on, label, hint]) => (
            <button
              key={label}
              type="button"
              aria-pressed={value.hasDeadline === on}
              onClick={() => {
                set({ hasDeadline: on })
              }}
              className={cn(
                'grid min-h-tap cursor-pointer content-start gap-0.5 rounded-button p-3 text-left',
                value.hasDeadline === on
                  ? 'bg-accent/10 ring-3 ring-accent-strong'
                  : 'bg-bg ring-2 ring-track',
              )}
            >
              <span className="font-extrabold">{label}</span>
              <span className={hintClass}>{hint}</span>
            </button>
          ))}
        </div>
        {value.hasDeadline && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">
                <span className={hintClass}>{t.dueDay}</span>
                <Select
                  value={String(value.dayOffset)}
                  onValueChange={(v) => {
                    set({ dayOffset: Number(v) })
                  }}
                >
                  <SelectTrigger aria-label={t.dueDay}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {t.dayOffsets.map((label, i) => (
                      <SelectItem key={label} value={String(i)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-1">
                <span className={hintClass}>{t.dueTime}</span>
                <Input
                  type="time"
                  required
                  value={value.dueTime}
                  onChange={(e) => {
                    set({ dueTime: e.target.value })
                  }}
                  className="font-bold"
                />
              </label>
            </div>
            <div className="grid gap-1" role="group" aria-labelledby="grace-label">
              <span id="grace-label" className={hintClass}>
                {t.grace}
              </span>
              <div className="flex items-center gap-2.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={cs.tasks.less}
                  disabled={value.graceHours <= 0}
                  onClick={() => {
                    set({ graceHours: Math.max(0, value.graceHours - 1) })
                  }}
                >
                  <Minus aria-hidden="true" />
                </Button>
                <span className="flex-1 text-center num text-2xl">{t.hours(value.graceHours)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={cs.tasks.more}
                  disabled={value.graceHours >= MAX_GRACE_HOURS}
                  onClick={() => {
                    set({ graceHours: Math.min(MAX_GRACE_HOURS, value.graceHours + 1) })
                  }}
                >
                  <Plus aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}
