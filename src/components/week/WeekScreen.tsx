import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { DisputeControl } from '~/components/disputes/DisputeControl'
import { DisputeList } from '~/components/disputes/DisputeList'
import { recordDispute, weekItemDispute } from '~/components/disputes/disputeProps'
import { EmptyState } from '~/components/EmptyState'
import { levelBadgeClass, levelLabel, weekLabel } from '~/components/period/periodView'
import { PointsBar } from '~/components/points/PointsBar'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { StateChip } from '~/components/tasks/StateChip'
import { TaskRow } from '~/components/tasks/TaskRow'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { cs, formatPoints } from '~/lib/strings'
import { cn } from '~/lib/utils'
import type { DisputeListEntry } from '~/server/disputes/functions'
import type { HistoryWeek, Week, WeekItem, WeekTaker } from '~/server/settlement/functions'
import { historyLine, itemChip, itemMeta } from './weekView'

// Týden (#45, UI doc §7.1 TWeek): Tento týden / Historie. The server already filtered the data
// to what this viewer may see (a taker: only himself); this file only renders it.

export type WeekTab = 'this' | 'history'

/** The way into Příští týden (#43), with "Návrh čeká" while a proposal is open. */
export function NextWeekCard({ pending }: { pending: boolean }) {
  return (
    <Link
      to="/tyden/pristi"
      data-slot="next-week-card"
      className="mb-3.5 flex min-h-tap items-center gap-3 rounded-card bg-surface px-4 py-2.5 font-extrabold shadow-sticker"
    >
      <span className="min-w-0 flex-1">{cs.proposals.entry.card}</span>
      {pending && <StateChip state="proposed" label={cs.proposals.entry.pending} />}
      <ChevronRight aria-hidden="true" className="shrink-0" />
    </Link>
  )
}

export function WeekScreen({
  week,
  viewerRole,
  nextWeek,
  disputes = false,
  disputeList = [],
}: {
  week: Week
  viewerRole: 'taker' | 'giver'
  /** Set with the `periodProposals` switch on: the Příští týden card shows. */
  nextWeek?: { pending: boolean }
  /** The `disputes` switch (#46): Rozporovat on locked items, Rozporováno on Historie. */
  disputes?: boolean
  disputeList?: readonly DisputeListEntry[]
}) {
  const shared = { viewerRole, disputes, disputeList }
  return (
    <Tabs defaultValue="this">
      <TabsList>
        <TabsTrigger value="this">{cs.week.thisWeek}</TabsTrigger>
        <TabsTrigger value="history">{cs.week.history}</TabsTrigger>
      </TabsList>
      <TabsContent value="this">
        {nextWeek && <NextWeekCard pending={nextWeek.pending} />}
        <WeekBody week={week} tab="this" {...shared} />
      </TabsContent>
      <TabsContent value="history">
        <WeekBody week={week} tab="history" {...shared} />
      </TabsContent>
    </Tabs>
  )
}

/** One tab; no hooks, so each state renders in a test. */
export function WeekBody({
  week,
  tab,
  viewerRole,
  disputes = false,
  disputeList = [],
}: {
  week: Week
  tab: WeekTab
  viewerRole: 'taker' | 'giver'
  disputes?: boolean
  disputeList?: readonly DisputeListEntry[]
}) {
  const named = viewerRole === 'giver'
  if (tab === 'history') {
    return (
      <>
        {disputes && <DisputeList entries={disputeList} />}
        {week.history.length === 0 ? (
          <EmptyState>{cs.week.noHistory}</EmptyState>
        ) : (
          <ul className="grid gap-3">
            {week.history.map((h) => (
              <HistoryCard key={h.periodId} week={h} named={named} disputes={disputes} />
            ))}
          </ul>
        )}
      </>
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
          <TakerWeek key={t.id} taker={t} week={week} named={named} disputes={disputes} />
        ))}
      </ul>
    </div>
  )
}

function TakerWeek({
  taker,
  week,
  named,
  disputes,
}: {
  taker: WeekTaker
  week: Week
  named: boolean
  disputes: boolean
}) {
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
          <p
            className="num text-lg font-bold"
            aria-label={`${String(taker.confirmed)} ${cs.points.confirmed} + ${String(taker.pending)} ${cs.points.pending}`}
          >
            <span className="text-state-confirmed-text">{taker.confirmed} ✔</span>
            <span className="text-muted"> + </span>
            <span className="text-state-pending-text">{taker.pending} ⏳</span>
          </p>
        )}
        <p className="text-meta text-muted">{cs.week.carried(formatPoints(taker.carriedIn))}</p>
        {taker.unsettled > 0 && (
          <p className="text-meta font-bold text-state-pending-text">
            {cs.week.unsettled(formatPoints(taker.unsettled))}
          </p>
        )}
      </div>
      {week.period && (
        <section className="grid gap-2">
          <SectionLabel>{cs.week.happened}</SectionLabel>
          {taker.items.length === 0 ? (
            <EmptyState>{cs.week.noItems}</EmptyState>
          ) : (
            <ul className="grid gap-2">
              {taker.items.map((item) => {
                const d = disputes ? weekItemDispute(item, named ? taker.name : null) : null
                return (
                  <li key={`${item.status}-${String(item.taskId)}-${item.at}`}>
                    <TaskRow
                      name={item.title}
                      state={itemChip(item)}
                      points={item.score}
                      meta={itemMeta(item)}
                      detail={rejectionLine(item, named ? taker.name : null)}
                      footer={d && <DisputeControl {...d} mark={item.dispute?.mark ?? null} />}
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </li>
  )
}

/**
 * Under a rejected item: the giver's reason, then that it went back to the boy. A rejected
 * self-log (`closed`) went nowhere: only the reason, or that it earned nothing.
 */
export function rejectionLine(item: WeekItem, takerName: string | null): string | undefined {
  if (item.status !== 'rejected') return undefined
  if (item.closed) return item.reason ?? cs.week.rejectedClosed
  const back = takerName === null ? cs.week.returnedToMe : cs.week.returnedTo(takerName)
  return item.reason ? `${item.reason} ${back}` : back
}

function HistoryCard({
  week,
  named,
  disputes,
}: {
  week: HistoryWeek
  named: boolean
  disputes: boolean
}) {
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
            {disputes && <DisputeControl {...recordDispute(week, r, named)} mark={r.dispute} />}
          </li>
        ))}
      </ul>
    </li>
  )
}
