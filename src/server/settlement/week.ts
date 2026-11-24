import { and, asc, gte, inArray } from 'drizzle-orm'
import { effectiveSettlement, periodEnd } from '~/domain'
import type { Level, Levels, Role } from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { pointAdjustments, settlements, tasks } from '~/server/db/schema'
import type { SettlementCorrectionRow } from '~/server/db/schema'
import { correctionPeriods, latestCorrections, toCorrection } from '~/server/corrections/read'
import { currentPeriod, listPeriods } from '~/server/periods'
import { rejectionsSince } from '~/server/tasks/rejections'
import { listPeople } from '~/server/users/people'
import { disputeMarks, markKey } from '~/server/disputes'
import type { DisputeItem, DisputeMark } from '~/server/disputes'
import { takerPointsNow } from './ledger'
import { takersOf } from './meeting'

// Týden (#45, spec §5.7–§5.9): this week and the settled weeks. A taker sees only himself; a
// giver sees every active taker (§5.7). The filter is here, on the server, and default-deny:
// everyone only for a giver. Read-only. Confirmed and rejected items and the settled records
// carry their dispute mark (#46), read only for what this viewer is shown.
// `unsettled` is the ledger total minus this week's bar. Point adjustments (#48) made since the
// week started land in `confirmed` here, so they never read as "waiting for the meeting".

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
  /**
   * Confirmed and rejected items (#46): what a dispute on it names and its mark (open, or the
   * latest outcome; null without one). Waiting items have none: not locked yet.
   */
  dispute?: { item: { kind: 'completion' | 'rejection'; id: number }; mark: DisputeMark | null }
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
  /**
   * His point adjustments (#48) since his latest settled week ended (none settled: all of them),
   * oldest first; those from before this week started wait for the meeting.
   */
  adjustments: WeekAdjustment[]
}

/** A point adjustment as Týden lists it (#48). */
export interface WeekAdjustment {
  id: number
  points: number
  reason: string
  /** UTC ISO: when the admin made it. */
  at: string
  /** For one from a settlement correction: the corrected week; null for a manual one. */
  fromWeek: { startsAt: string; endsAt: string } | null
  /** Made before this week started: in `unsettled`, waiting for the meeting. */
  waiting: boolean
  /** Manual ones only (a correction's is disputed via its settlement): item and mark. */
  dispute: { item: { kind: 'adjustment'; id: number }; mark: DisputeMark | null } | null
}

export interface HistoryRecord {
  /** The settlement record's id (a dispute names it, #46). */
  id: number
  takerId: number
  name: string
  totalBefore: number
  level: Level
  deducted: number
  carryOver: number
  /** The record's dispute mark, null without one (#46). */
  dispute: DisputeMark | null
  /** Its latest correction (#48): the effective level and deduction, why and when; else null. */
  correction: { level: Level; deducted: number; reason: string; at: string } | null
  /** His adjustments made in this week (#48), oldest first. */
  adjustments: WeekAdjustment[]
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
  const spans = periodSpans(db)
  const adjusted = adjustmentsOf(db, ids, spans)
  // Marks only for what this viewer is shown, so a taker never reads another boy's notes.
  const shown: DisputeItem[] = rows.map((r) => ({ kind: 'settlement', id: r.id }))
  for (const list of items.values()) for (const i of list) if (i.dispute) shown.push(i.dispute.item)
  for (const a of adjusted) if (a.dispute) shown.push(a.dispute.item)
  const marks = disputeMarks(db, shown)
  for (const list of items.values()) {
    for (const i of list) if (i.dispute) i.dispute.mark = marks.get(markKey(i.dispute.item)) ?? null
  }
  for (const a of adjusted)
    if (a.dispute) a.dispute.mark = marks.get(markKey(a.dispute.item)) ?? null
  // His latest settled week's end: what came after it is this week or waits for the meeting.
  const settledUntil = new Map<number, string>()
  for (const r of rows) {
    const end = spans.get(r.periodId)?.endsAt
    if (end) settledUntil.set(r.takerId, end)
  }
  const weekStart = period ? toIsoUtc(period.startsAt) : null
  const current = (takerId: number) =>
    adjusted
      .filter((a) => a.takerId === takerId && a.madeAt >= (settledUntil.get(takerId) ?? ''))
      .map((a) => ({ ...a.row, waiting: weekStart === null || a.madeAt < weekStart }))
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
      const base = {
        id: t.id,
        name: t.name,
        carriedIn,
        items: items.get(t.id) ?? [],
        adjustments: current(t.id),
      }
      if (!thisWeek) return { ...base, ...all, unsettled: 0 }
      // Running total = carry-over + this week + the ended, unsettled weeks; the rest is those.
      const now = thisWeek.get(t.id) ?? { confirmed: 0, pending: 0 }
      const confirmed = carriedIn + now.confirmed
      const unsettled = all.confirmed - confirmed + (all.pending - now.pending)
      return { ...base, confirmed, pending: now.pending, unsettled }
    }),
    history: history(db, rows, names, marks, spans, adjusted),
  }
}

/**
 * Confirmed and waiting scores per taker, of tasks completed at or after `start`; adjustments
 * made at or after `start` count as confirmed.
 */
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
  for (const a of db
    .select({ takerId: pointAdjustments.takerId, points: pointAdjustments.points })
    .from(pointAdjustments)
    .where(
      and(inArray(pointAdjustments.takerId, ids), gte(pointAdjustments.madeAt, toIsoUtc(start))),
    )
    .all()) {
    const p = out.get(a.takerId) ?? { confirmed: 0, pending: 0 }
    p.confirmed += a.points
    out.set(a.takerId, p)
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
    const confirmed = t.status === 'confirmed'
    out.get(t.earnerId)?.push({
      taskId: t.id,
      title: t.title,
      score: t.score,
      status: confirmed ? 'confirmed' : 'done_unconfirmed',
      at: t.completedAt,
      reason: null,
      ...(confirmed ? { dispute: { item: { kind: 'completion', id: t.id }, mark: null } } : {}),
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
      dispute: { item: { kind: 'rejection', id: r.entryId }, mark: null },
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
  marks: Map<string, DisputeMark>,
  spans: Map<number, Span>,
  adjusted: Adjusted[],
): HistoryWeek[] {
  const weeks: HistoryWeek[] = []
  const latest = latestCorrections(
    db,
    rows.map((r) => r.id),
  )
  for (const p of [...listPeriods(db)].reverse()) {
    const span = spans.get(p.id)
    const within = (takerId: number) =>
      span
        ? adjusted
            .filter(
              (a) => a.takerId === takerId && a.madeAt >= span.startsAt && a.madeAt < span.endsAt,
            )
            .map((a) => ({ ...a.row, waiting: false }))
        : []
    const records = rows
      .filter((r) => r.periodId === p.id)
      .sort((a, b) => a.takerId - b.takerId)
      .map((r) => ({
        id: r.id,
        takerId: r.takerId,
        name: names.get(r.takerId) ?? '',
        totalBefore: r.totalBefore,
        level: r.level,
        deducted: r.deducted,
        carryOver: r.carryOver,
        dispute: marks.get(markKey({ kind: 'settlement', id: r.id })) ?? null,
        correction: correctionOf(r, latest.get(r.id)),
        adjustments: within(r.takerId),
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

interface Span {
  startsAt: string
  endsAt: string
}

/** Every period's [start, end) in UTC ISO, by id. */
function periodSpans(db: Db | Tx): Map<number, Span> {
  return new Map(
    listPeriods(db).map((p) => [
      p.id,
      { startsAt: toIsoUtc(p.startsAt), endsAt: toIsoUtc(periodEnd(p)) },
    ]),
  )
}

interface Adjusted {
  takerId: number
  madeAt: string
  row: Omit<WeekAdjustment, 'waiting'>
  dispute: WeekAdjustment['dispute']
}

/** The given takers' adjustments, oldest first, with a correction's week (#48). */
function adjustmentsOf(db: Db | Tx, ids: number[], spans: Map<number, Span>): Adjusted[] {
  if (ids.length === 0) return []
  const all = db
    .select()
    .from(pointAdjustments)
    .where(inArray(pointAdjustments.takerId, ids))
    .orderBy(asc(pointAdjustments.madeAt), asc(pointAdjustments.id))
    .all()
  const corrected = correctionPeriods(
    db,
    all.flatMap((a) => (a.correctionId === null ? [] : [a.correctionId])),
  )
  return all.map((a) => {
    const periodId = a.correctionId === null ? undefined : corrected.get(a.correctionId)
    const dispute =
      a.correctionId === null
        ? { item: { kind: 'adjustment' as const, id: a.id }, mark: null }
        : null
    // One object: the mark set on `dispute` later shows in `row` too.
    const row = {
      id: a.id,
      points: a.points,
      reason: a.reason,
      at: a.madeAt,
      fromWeek: periodId === undefined ? null : (spans.get(periodId) ?? null),
      dispute,
    }
    return { takerId: a.takerId, madeAt: a.madeAt, row, dispute }
  })
}

function correctionOf(
  r: typeof settlements.$inferSelect,
  latest: SettlementCorrectionRow | undefined,
): HistoryRecord['correction'] {
  if (!latest) return null
  const now = effectiveSettlement(r, toCorrection(r, latest))
  return { ...now, reason: latest.reason, at: latest.madeAt }
}
