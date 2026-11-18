import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Screen } from '~/components/shell/Screen'
import { ScoreDial } from '~/components/tasks/ScoreDial'
import { sectionLabelClass } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { taskErrorMessage } from '~/lib/taskErrors'
import { TASK_SCORE_MAX, TASK_TITLE_MAX } from '~/lib/taskLimits'
import { createTaskFn } from '~/server/tasks/functions'

// Nový úkol, the one-time part of GCreate (UI doc §7.2): name, points with − / + around a
// swipe dial (UI doc §5: no typing; dial per Jakub 2026-11-18), approval flag (default on,
// spec §5.5).
// Recurring templates join with #37.
export const Route = createFileRoute('/_app/ukoly/novy')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/ukoly/novy')
  },
  component: NewTask,
})

/** Everyday chores go for 2–5 points, weekly goals are 10–15 (Jakub 2026-11-18). */
const START_SCORE = 3
const MAX_SCORE = TASK_SCORE_MAX
/** One tap to a common value; the bigger ones are for one-off jobs. */
const QUICK_PICKS = [2, 5, 10, 20] as const

function NewTask() {
  const { user } = Route.useRouteContext()
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [score, setScore] = useState(START_SCORE)
  const [approvalRequired, setApprovalRequired] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const result = await createTaskFn({ data: { title, score, approvalRequired } })
      if (!result.ok) {
        setError(taskErrorMessage(result.error))
        return
      }
      toast.success(cs.tasks.created)
      await router.navigate({ to: '/ukoly' })
    } catch {
      setError(cs.login.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title={cs.tasks.createTitle} user={user} back="/ukoly">
      <form
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Card className="grid gap-3">
          <label className="grid gap-2">
            <span className={sectionLabelClass}>{cs.tasks.title}</span>
            <Input
              name="title"
              required
              maxLength={TASK_TITLE_MAX}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setError(null)
              }}
              aria-invalid={error !== null}
              aria-describedby={error ? 'task-error' : undefined}
              className="font-bold"
            />
          </label>
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
                disabled={score <= 1}
                onClick={() => {
                  setScore((s) => Math.max(1, s - 1))
                }}
              >
                <Minus aria-hidden="true" />
              </Button>
              <ScoreDial
                value={score}
                min={1}
                max={MAX_SCORE}
                onChange={setScore}
                label={cs.tasks.score}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={cs.tasks.more}
                disabled={score >= MAX_SCORE}
                onClick={() => {
                  setScore((s) => Math.min(MAX_SCORE, s + 1))
                }}
              >
                <Plus aria-hidden="true" />
              </Button>
            </div>
            <div className="flex gap-2" role="group" aria-label={cs.tasks.quickPick}>
              {QUICK_PICKS.map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={score === value ? 'primary' : 'ghost'}
                  aria-pressed={score === value}
                  className="flex-1 num"
                  onClick={() => {
                    setScore(value)
                  }}
                >
                  {value}
                </Button>
              ))}
            </div>
          </div>
          <label className="flex min-h-tap items-center gap-2.5 text-row font-extrabold">
            <input
              type="checkbox"
              checked={approvalRequired}
              onChange={(e) => {
                setApprovalRequired(e.target.checked)
              }}
              className="size-5.5 accent-accent-strong"
            />
            {cs.tasks.approvalRequired}
          </label>
        </Card>
        {error && (
          <p id="task-error" role="alert" className="font-bold text-state-rejected-text">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={busy} className="w-full">
          {cs.tasks.propose}
        </Button>
        <p className="text-center text-meta font-bold text-muted">{cs.tasks.proposeHint}</p>
      </form>
    </Screen>
  )
}
