import { sectionLabelClass } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { ScoreStepper } from './ScoreStepper'

/** Everyday chores go for 2–5 points, weekly goals are 10–15 (Jakub 2026-11-18). */
export const START_SCORE = 3
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
      <ScoreStepper value={value} onChange={onChange} label={cs.tasks.score} />
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
