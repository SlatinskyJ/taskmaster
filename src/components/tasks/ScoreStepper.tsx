import { Minus, Plus } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { TASK_SCORE_MAX } from '~/lib/taskLimits'
import { ScoreDial } from './ScoreDial'

/** − / swipe dial / + for a score (UI doc §5: no typing). Each button stops at its end. */
export function ScoreStepper({
  value,
  onChange,
  label,
  min = 1,
  max = TASK_SCORE_MAX,
  lessLabel = cs.tasks.less,
  moreLabel = cs.tasks.more,
}: {
  value: number
  onChange: (n: number) => void
  label: string
  min?: number
  max?: number
  /** Accessible names of − and +, when one screen has several steppers. */
  lessLabel?: string
  moreLabel?: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={lessLabel}
        disabled={value <= min}
        onClick={() => {
          onChange(Math.max(min, value - 1))
        }}
      >
        <Minus aria-hidden="true" />
      </Button>
      <ScoreDial value={value} min={min} max={max} onChange={onChange} label={label} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={moreLabel}
        disabled={value >= max}
        onClick={() => {
          onChange(Math.min(max, value + 1))
        }}
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  )
}
