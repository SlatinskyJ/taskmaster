import { EmptyState } from '~/components/EmptyState'
import { levelBadgeClass, levelLabel, weekLabel } from '~/components/period/periodView'
import { PointsBar } from '~/components/points/PointsBar'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { TaskRow } from '~/components/tasks/TaskRow'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { cs, formatPoints } from '~/lib/strings'
import { cn } from '~/lib/utils'
import type { HistoryWeek, Week, WeekTaker } from '~/server/settlement/functions'
import { historyLine, itemChip, itemMeta } from './weekView'

// Týden (#45, UI doc §7.1 TWeek): Tento týden / Historie. The server already filtered the data
// to what this viewer may see (a taker: only himself); this file only renders it.

export type WeekTab = 'this' | 'history'

export function WeekScreen({ week, viewerRole }: { week: Week; viewerRole: 'taker' | 'giver' }) {
  return (
    <Tabs defaultValue="this" className="px-4 pb-6">
      <TabsList>
        <TabsTrigger value="this">{cs.week.thisWeek}</TabsTrigger>
        <TabsTrigger value="history">{cs.week.history}</TabsTrigger>
      </TabsList>
      <TabsContent value="this">
        <WeekBody week={week} tab="this" viewerRole={viewerRole} />
      </TabsContent>
      <TabsContent value="history">
        <WeekBody week={week} tab="history" viewerRole={viewerRole} />
      </TabsContent>
    </Tabs>
  )
}

/** One tab; no hooks, so each state renders in a test. */
export function WeekBody({
  week,
  tab,
  viewerRole,
}: {
  week: Week
  tab: WeekTab
  viewerRole: 'taker' | 'giver'
}) {
  const named = viewerRole === 'giver'
  if (tab === 'history') {
    return week.history.length === 0 ? (
      <EmptyState>{cs.week.noHistory}</EmptyState>
    ) : (
      <ul className="grid gap-3">
        {week.history.map((h) => (
          <HistoryCard key={h.periodId} week={h} named={named} />
        ))}
      </ul>
    )
  }
  return (
    <div className="grid gap-3">
      {week.period ? (
        <p className="text-meta font-bold text-muted">
          {weekLabel(week.period.startsAt, week.period.cutoffAt)}
        </p>
      ) : (
        <p className="text-meta font-bold text-muted">{cs.week.noPeriod}</p>
      )}
      <ul className="grid gap-3">
        {week.takers.map((t) => (
          <TakerWeek key={t.id} taker={t} week={week} named={named} />
        ))}
      </ul>
    </div>
  )
}

function TakerWeek({ taker, week, named }: { taker: WeekTaker; week: Week; named: boolean }) {
  const levels = week.period?.levels
  return (
    <li data-taker={taker.id} className="grid gap-3">
      <div className="grid gap-2 rounded-card bg-surface p-4 shadow-sticker">
        {named && <p className="min-w-0 text-row font-bold break-words">{taker.name}</p>}
        {levels && (
          <PointsBar
            confirmed={taker.confirmed}
            pending={taker.pending}
            lower={levels.lower}
            upper={levels.upper}
            subject={String(taker.id)}
          />
        )}
        {!levels && (
          <p className="num text-lg font-bold">
            <span className="text-state-confirmed-text">{taker.confirmed} ✔</span>
            <span className="text-muted"> + </span>
            <span className="text-state-pending-text">{taker.pending} ⏳</span>
          </p>
        )}
        <p className="text-meta text-muted">
          {cs.week.carried(formatPoints(taker.carriedIn))}
          {levels && ` · ${cs.week.levels(levels.lower, levels.upper)}`}
        </p>
      </div>
      {week.period && (
        <section className="grid gap-2">
          <SectionLabel>{cs.week.happened}</SectionLabel>
          {taker.items.length === 0 ? (
            <EmptyState>{cs.week.noItems}</EmptyState>
          ) : (
            <ul className="grid gap-2">
              {taker.items.map((item) => (
                <li key={`${item.status}-${String(item.taskId)}-${item.at}`}>
                  {/* #46: Rozporovat on a confirmed or a rejected item goes here. */}
                  <TaskRow
                    name={item.title}
                    state={itemChip(item)}
                    points={item.score}
                    meta={itemMeta(item)}
                    detail={item.reason ?? undefined}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </li>
  )
}

function HistoryCard({ week, named }: { week: HistoryWeek; named: boolean }) {
  return (
    <li
      data-period={week.periodId}
      className="grid gap-3 rounded-card bg-surface p-4 shadow-sticker"
    >
      <p className="text-meta font-bold text-muted">
        {weekLabel(week.startsAt, week.endsAt)} · {cs.meeting.levelsLabel} {week.levels.lower} /{' '}
        {week.levels.upper}
      </p>
      <ul className="grid gap-3">
        {week.records.map((r) => (
          <li key={r.takerId} data-record={r.takerId} className="grid gap-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {named && <span className="min-w-0 text-row font-bold break-words">{r.name}</span>}
              <span
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-chip font-bold',
                  levelBadgeClass(r.level),
                )}
              >
                {levelLabel(r.level)}
              </span>
            </div>
            <p className="num text-meta">{historyLine(r)}</p>
            {/* #46: Rozporovat on a settlement record goes here. */}
          </li>
        ))}
      </ul>
    </li>
  )
}
