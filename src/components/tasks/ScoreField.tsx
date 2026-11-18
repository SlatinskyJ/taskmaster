import { Minus, Plus } from 'lucide-react'
import { sectionLabelClass } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { ScoreDial } from './ScoreDial'

/** Everyday chores go for 2–5 points, weekly goals are 10–15 (Jakub 2026-11-18). */
export const START_SCORE = 3
const MAX_SCORE = 999
/** One tap to a common value; the bigger ones are for one-off jobs. */
const QUICK_PICKS = [2, 5, 10, 20] as const

/**
 * Points for a new task or template: − / + around a swipe dial and quick picks (UI doc §5: no
 * typing; dial per Jakub 2026-11-18).
 */
export function ScoreField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="grid gap-2" role="group" aria-labelledby="score-label">
      <span id="score-label" className={sectionLabelClass}>
        {cs.tasks.score}
      </span>
      <div className="flex items-center gap-2.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={cs.tasks.less}
          disabled={value <= 1}
          onClick={() => {
            onChange(Math.max(1, value - 1))
          }}
        >
          <Minus aria-hidden="true" />
        </Button>
        <ScoreDial
          value={value}
          min={1}
          max={MAX_SCORE}
          onChange={onChange}
          label={cs.tasks.score}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={cs.tasks.more}
          disabled={value >= MAX_SCORE}
          onClick={() => {
            onChange(Math.min(MAX_SCORE, value + 1))
          }}
        >
          <Plus aria-hidden="true" />
        </Button>
      </div>
      <div className="flex gap-2" role="group" aria-label={cs.tasks.quickPick}>
        {QUICK_PICKS.map((pick) => (
          <Button
            key={pick}
            type="button"
            variant={value === pick ? 'primary' : 'ghost'}
            aria-pressed={value === pick}
            className="flex-1 num"
            onClick={() => {
              onChange(pick)
            }}
          >
            {pick}
          </Button>
        ))}
      </div>
    </div>
  )
}
