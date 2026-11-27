import { RefreshCw } from 'lucide-react'
import { weekLabel } from '~/components/period/periodView'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { WeekPlanTable } from '~/components/week/WeekPlanTable'
import { cs } from '~/lib/strings'
import type { PlanAnswer } from '~/server/instances/functions'

/**
 * The week plan in Schůzka step 3 (#259, spec §5.12 "At the meeting", UI doc §7.3 M3Plan): #258's
 * table, giver view, under the open tasks on the settlement's day. Obnovit refetches it; nothing
 * refreshes by itself. Hook-free: the refresh state lives in `planRefresh.ts`.
 */
export function MeetingWeekPlanView({
  plan,
  busy,
  failed,
  viewerId,
  onRefresh,
}: {
  plan: PlanAnswer
  busy: boolean
  failed: boolean
  viewerId: number
  onRefresh: () => void
}) {
  if ('error' in plan) return null
  return (
    <section aria-labelledby="meeting-plan-label" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <SectionLabel id="meeting-plan-label">{cs.plan.title}</SectionLabel>
          {plan.period && (
            <p className="num text-meta text-muted">
              {weekLabel(plan.period.startsAt, plan.period.cutoffAt)}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          className="shrink-0"
          disabled={busy}
          aria-busy={busy}
          onClick={onRefresh}
        >
          <RefreshCw
            aria-hidden
            className={busy ? 'animate-spin motion-reduce:animate-none' : undefined}
          />
          {cs.meeting.refresh}
        </Button>
      </div>
      {/* No rows: nothing to reserve, so the hint would only contradict #258's empty state. */}
      {plan.rows.length > 0 && (
        <p className="text-meta break-words text-muted">{cs.meeting.planHint}</p>
      )}
      {failed && (
        <p role="alert" className="text-meta font-bold break-words text-destructive">
          {cs.meeting.refreshFailed}
        </p>
      )}
      <WeekPlanTable plan={plan} viewer={{ id: viewerId, role: 'giver' }} />
    </section>
  )
}
