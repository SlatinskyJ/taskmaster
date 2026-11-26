import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { Screen } from '~/components/shell/Screen'
import { sectionLabelClass } from '~/components/shell/SectionLabel'
import { ScoreField, START_SCORE } from '~/components/tasks/ScoreField'
import type { ItemKind, RecurringValue } from '~/components/templates/actions'
import { NewDescriptionField } from '~/components/descriptions/NewDescriptionField'
import { DEFAULT_RECURRING, submitNewItem } from '~/components/templates/actions'
import { RecurringFields } from '~/components/templates/RecurringFields'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { taskErrorMessage } from '~/lib/taskErrors'
import { TASK_TITLE_MAX } from '~/lib/taskLimits'
import { cn } from '~/lib/utils'

// Nový úkol (UI doc §7.2 GCreate): one-time task or recurring template. Name, points (ScoreField),
// approval flag (default on, spec §5.5); for a template also the schedule and deadline rule
// (spec §5.3, RecurringFields).
export const Route = createFileRoute('/_app/ukoly/novy')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/ukoly/novy')
  },
  component: NewTask,
})

const KINDS: readonly [ItemKind, string][] = [
  ['one_time', cs.templates.kindOneTime],
  ['recurring', cs.templates.kindRecurring],
]

function NewTask() {
  const { user, features } = Route.useRouteContext()
  const router = useRouter()
  const [kind, setKind] = useState<ItemKind>('one_time')
  const [title, setTitle] = useState('')
  const [score, setScore] = useState(START_SCORE)
  const [approvalRequired, setApprovalRequired] = useState(true)
  const [description, setDescription] = useState('')
  const [recurring, setRecurring] = useState<RecurringValue>(DEFAULT_RECURRING)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const result = await submitNewItem(kind, {
        title,
        score,
        approvalRequired,
        recurring,
        description: features.descriptions ? description : '',
      })
      if (!result.ok) {
        setError(taskErrorMessage(result.error))
        return
      }
      toast.success(kind === 'recurring' ? cs.templates.created : cs.tasks.created)
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
        {features.recurring && (
          <div className="grid grid-cols-2 gap-1 rounded-card bg-track p-1">
            {KINDS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k)
                  setError(null)
                }}
                className={cn(
                  'min-h-tap cursor-pointer rounded-button font-extrabold',
                  kind === k ? 'bg-surface text-ink shadow-sticker' : 'text-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
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
          {features.descriptions && (
            <NewDescriptionField value={description} onChange={setDescription} />
          )}
          <ScoreField value={score} onChange={setScore} />
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
        {kind === 'recurring' && (
          <RecurringFields
            value={recurring}
            onChange={(v) => {
              setRecurring(v)
              setError(null)
            }}
          />
        )}
        {error && (
          <p id="task-error" role="alert" className="font-bold text-state-rejected-text">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={busy} aria-busy={busy} className="w-full">
          {cs.tasks.propose}
        </Button>
        <p className="text-center text-meta font-bold text-muted">
          {kind === 'recurring' ? cs.templates.proposeHint : cs.tasks.proposeHint}
        </p>
      </form>
    </Screen>
  )
}
