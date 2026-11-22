import { and, asc, gte, inArray } from 'drizzle-orm'
import { periodEnd } from '~/domain'
import type { Level, Levels, Role } from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { settlements, tasks } from '~/server/db/schema'
import { currentPeriod, listPeriods } from '~/server/periods'
import { rejectionsSince } from '~/server/tasks/rejections'
import { listPeople } from '~/server/users/people'
import { takerPointsNow } from './ledger'
import { takersOf } from './meeting'

// Týden (#45, spec §5.7–§5.9): this week and the settled weeks. A taker sees only himself; a
// giver sees every active taker (§5.7). The filter is here, on the server, and default-deny:
// everyone only for a giver. Read-only.
// `unsettled` is the ledger total minus this week's bar. When #47/#36 add adjustments to the
// ledger, they must land in `confirmed` here, or they would read as "waiting for the meeting".

export interface WeekItem {
  taskId: number
  title: string
  score: number
  status: 'confirmed' | 'done_unconfirmed' | 'rejected'
  /** UTC ISO: completion time; for a rejection, when it was rejected. */
  at: string
  /** Rejections only: the giver's reason, else null. */
  reason: string | null
  /** Rejections only: a rejected self-log, which did not go back to the taker. */
  closed?: boolean
}

export interface WeekTaker {
  id: number
  name: string
  /**
   * With a period: carry-over + confirmed this period (§5.7). Without one: the running total.
   */
  confirmed: number
  /** Done, waiting for a giver: this period's, or all of them without a period. */
  pending: number
  /** The carry-over of his latest settlement, else 0. */
  carriedIn: number
  /**
   * Points from an ended week no meeting has settled yet, confirmed and waiting (Jakub
   * 2026-11-21: shown apart until settled, not on this week's bar). 0 once settled.
   */
  unsettled: number
  /** Newest first. */
  items: WeekItem[]
}

export interface HistoryRecord {
  takerId: number
  name: string
  totalBefore: number
  level: Level
  deducted: number
  carryOver: number
}

export interface HistoryWeek {
  periodId: number
  startsAt: string
  /** The week's real end: when the meeting ended it, else its cutoff. */
  endsAt: string
  levels: Levels
  /** By taker id. */
  records: HistoryRecord[]
}

export interface Week {
  period: { id: number; startsAt: string; cutoffAt: string; levels: Levels } | null
  /** By user id. */
  takers: WeekTaker[]
  /** Newest first. */
  history: HistoryWeek[]
}

export interface Viewer {
  id: number
  role: Role
}

export function getWeek(db: Db | Tx, viewer: Viewer, now: Date): Week {
  const visible = (id: number) => viewer.role === 'giver' || id === viewer.id
  const takers = takersOf(db, listPeople(db)).filter((t) => visible(t.id))
  const names = new Map(takers.map((t) => [t.id, t.name]))
  const ids = takers.map((t) => t.id)
  const period = currentPeriod(db, now)
  const points = takerPointsNow(db)
  const rows =
    ids.length === 0
      ? []
      : db
          .select()
          .from(settlements)
          .where(inArray(settlements.takerId, ids))
          .orderBy(asc(settlements.settledAt), asc(settlements.id))
          .all()
  const carried = new Map<number, number>()
  for (const r of rows) carried.set(r.takerId, r.carryOver)
  const items = period ? weekItems(db, ids, period.startsAt) : new Map<number, WeekItem[]>()
  const thisWeek = period ? pointsSince(db, ids, period.startsAt) : null
  return {
    period: period
      ? {
          id: period.id,
          startsAt: toIsoUtc(period.startsAt),
          cutoffAt: toIsoUtc(period.cutoffAt),
          levels: period.levels,
        }
      : null,
    takers: takers.map((t) => {
      const all = points.get(t.id) ?? { confirmed: 0, pending: 0 }
      const carriedIn = carried.get(t.id) ?? 0
      const base = { id: t.id, name: t.name, carriedIn, items: items.get(t.id) ?? [] }
      if (!thisWeek) return { ...base, ...all, unsettled: 0 }
      // Running total = carry-over + this week + the ended, unsettled weeks; the rest is those.
      const now = thisWeek.get(t.id) ?? { confirmed: 0, pending: 0 }
      const confirmed = carriedIn + now.confirmed
      const unsettled = all.confirmed - confirmed + (all.pending - now.pending)
      return { ...base, confirmed, pending: now.pending, unsettled }
    }),
    history: history(db, rows, names),
  }
}

/** Confirmed and waiting scores per taker, of tasks completed at or after `start`. */
function pointsSince(
  db: Db | Tx,
  ids: number[],
  start: Date,
): Map<number, { confirmed: number; pending: number }> {
  const out = new Map<number, { confirmed: number; pending: number }>()
  if (ids.length === 0) return out
  for (const t of db
    .select({ earnerId: tasks.earnerId, score: tasks.score, status: tasks.status })
    .from(tasks)
    .where(
      and(
        inArray(tasks.earnerId, ids),
        inArray(tasks.status, ['confirmed', 'done_unconfirmed']),
        gte(tasks.completedAt, toIsoUtc(start)),
      ),
    )
    .all()) {
    if (t.earnerId === null) continue
    const p = out.get(t.earnerId) ?? { confirmed: 0, pending: 0 }
    if (t.status === 'confirmed') p.confirmed += t.score
    else p.pending += t.score
    out.set(t.earnerId, p)
  }
  return out
}

/** This period's items per taker: done since its start, still waiting, and its rejections. */
function weekItems(db: Db | Tx, ids: number[], start: Date): Map<number, WeekItem[]> {
  const out = new Map<number, WeekItem[]>(ids.map((id) => [id, []]))
  const since = toIsoUtc(start)
  for (const t of db
    .select()
    .from(tasks)
    .where(
      and(inArray(tasks.earnerId, ids), inArray(tasks.status, ['confirmed', 'done_unconfirmed'])),
    )
    .all()) {
    if (t.earnerId === null || t.completedAt === null) continue
    if (t.status !== 'done_unconfirmed' && t.completedAt < since) continue
    out.get(t.earnerId)?.push({
      taskId: t.id,
      title: t.title,
      score: t.score,
      status: t.status === 'confirmed' ? 'confirmed' : 'done_unconfirmed',
      at: t.completedAt,
      reason: null,
    })
  }
  for (const r of rejectionsSince(db, start)) {
    out.get(r.earnerId)?.push({
      taskId: r.taskId,
      title: r.title,
      score: r.score,
      status: 'rejected',
      at: r.at,
      reason: r.reason,
      closed: r.closed,
    })
  }
  for (const list of out.values())
    list.sort((a, b) => b.at.localeCompare(a.at) || b.taskId - a.taskId)
  return out
}

function history(
  db: Db | Tx,
  rows: (typeof settlements.$inferSelect)[],
  names: Map<number, string>,
): HistoryWeek[] {
  const weeks: HistoryWeek[] = []
  for (const p of [...listPeriods(db)].reverse()) {
    const records = rows
      .filter((r) => r.periodId === p.id)
      .sort((a, b) => a.takerId - b.takerId)
      .map((r) => ({
        takerId: r.takerId,
        name: names.get(r.takerId) ?? '',
        totalBefore: r.totalBefore,
        level: r.level,
        deducted: r.deducted,
        carryOver: r.carryOver,
      }))
    if (records.length === 0) continue
    weeks.push({
      periodId: p.id,
      startsAt: toIsoUtc(p.startsAt),
      endsAt: toIsoUtc(periodEnd(p)),
      levels: p.levels,
      records,
    })
  }
  return weeks
}
