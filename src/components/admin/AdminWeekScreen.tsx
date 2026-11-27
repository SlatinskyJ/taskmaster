import { EmptyState } from '~/components/EmptyState'
import { PointsBar } from '~/components/points/PointsBar'
import { dayLabel, levelBadgeClass, levelLabel, weekLabel } from '~/components/period/periodView'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { taskLink } from '~/components/tasks/rowLink'
import { TaskRow } from '~/components/tasks/TaskRow'
import { adjustmentRow, correctionLine, historyLine } from '~/components/week/weekView'
import { cs, formatPoints } from '~/lib/strings'
import { cn } from '~/lib/utils'
import type { AdminWeek } from '~/server/settlement/functions'
import { weekSoFar } from './adminWeekView'

// The admin's read-only view of one brother's week (#263), opened from a Sporné card: built
// from Týden's pieces. The admin is not a party, so no Rozporovat and no dispute marks.

export function AdminWeekScreen({ week }: { week: AdminWeek }) {
  const { record } = week
  const t = cs.admin.week
  const level = record ? (record.correction?.level ?? record.level) : null
  return (
    <div className="grid gap-3">
      <div className="grid gap-1 rounded-card bg-surface p-4 shadow-sticker">
        <p className="text-meta font-bold text-muted">
          {weekLabel(week.week.startsAt, week.week.endsAt)} · {cs.meeting.levelsLabel}{' '}
          {week.week.levels.lower} / {week.week.levels.upper}
        </p>
        {record && level ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-chip font-bold',
                  levelBadgeClass(level),
                )}
              >
                {levelLabel(level)}
              </span>
            </div>
            <p className="num text-meta">{historyLine(record)}</p>
            {record.correction && (
              <p className="text-meta font-bold break-words text-state-disputed-text">
                {correctionLine(record)}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-meta font-bold text-state-pending-text">{t.notSettled}</p>
            <PointsBar
              {...weekSoFar(week)}
              lower={week.week.levels.lower}
              upper={week.week.levels.upper}
              subject={`${String(week.taker.id)}/${String(week.week.periodId)}`}
            />
          </>
        )}
        <p className="text-meta text-muted">{cs.week.carried(formatPoints(week.carriedIn))}</p>
      </div>
      <section className="grid gap-2">
        <SectionLabel>{t.happened}</SectionLabel>
        {week.items.length === 0 && week.adjustments.length === 0 ? (
          <EmptyState>{t.noItems}</EmptyState>
        ) : (
          <ul className="grid gap-2">
            {week.adjustments.map((a) => {
              const row = adjustmentRow(a)
              return (
                <li key={`adjustment-${String(a.id)}`}>
                  <TaskRow
                    described={false}
                    name={row.name}
                    state={row.state}
                    stateLabel={row.stateLabel}
                    points={row.points}
                    meta={row.meta}
                    detail={row.detail}
                  />
                </li>
              )
            })}
            {week.items.map((item) => (
              <li key={`task-${String(item.taskId)}`}>
                <TaskRow
                  described={false}
                  name={item.title}
                  state={item.status === 'confirmed' ? 'confirmed' : 'pending'}
                  points={item.score}
                  meta={dayLabel(item.at)}
                  link={taskLink(item.taskId)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
