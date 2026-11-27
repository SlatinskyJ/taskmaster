import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm'
import type { Levels } from '~/domain'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { settlements, tasks, users } from '~/server/db/schema'
import { listPeriods } from '~/server/periods'
import { adjustmentsOf, historyRecords, periodSpans, withinSpan } from './week'
import type { HistoryRecord, WeekAdjustment } from './week'

// The admin's view of one brother's week (#263), opened from a settlement or adjustment card on
// Sporné: the level, the deduction and the carry-over once settled, and the tasks, chores and
// adjustments behind the total, as Týden shows them. Read-only. The admin is not a party, so it
// carries no dispute marks. A completion belongs to the week of its completed_at (§5.5) and an
// adjustment to the week it was made in; a week is [startsAt, end), end exclusive.

export interface AdminWeekItem {
  taskId: number
  title: string
  score: number
  status: 'confirmed' | 'done_unconfirmed'
  /** UTC ISO completed_at. */
  at: string
}

export interface AdminWeek {
  taker: { id: number; name: string }
  week: { periodId: number; startsAt: string; endsAt: string; levels: Levels }
  /** His settlement record of this week, as Týden's Historie shows it; null: not settled yet. */
  record: HistoryRecord | null
  /** The carry-over of his latest settlement of an earlier week, else 0. */
  carriedIn: number
  /** His completions with completed_at in the week (confirmed, and still waiting), newest first. */
  items: AdminWeekItem[]
  /** His adjustments made in the week, oldest first (`waiting: false`). */
  adjustments: WeekAdjustment[]
}

/** Null when the period or the user does not exist. */
export function getAdminWeek(db: Db | Tx, periodId: number, takerId: number): AdminWeek | null {
  const spans = periodSpans(db)
  const span = spans.get(periodId)
  const taker = db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(eq(users.id, takerId))
    .get()
  const period = listPeriods(db).find((p) => p.id === periodId)
  if (!span || !period || !taker) return null
  const items: AdminWeekItem[] = db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.earnerId, takerId),
        inArray(tasks.status, ['confirmed', 'done_unconfirmed']),
        gte(tasks.completedAt, span.startsAt),
        lt(tasks.completedAt, span.endsAt),
      ),
    )
    .all()
    .flatMap((t) =>
      t.completedAt === null
        ? []
        : [
            {
              taskId: t.id,
              title: t.title,
              score: t.score,
              status:
                t.status === 'confirmed' ? ('confirmed' as const) : ('done_unconfirmed' as const),
              at: t.completedAt,
            },
          ],
    )
    .sort((a, b) => b.at.localeCompare(a.at) || b.taskId - a.taskId)
  const adjusted = adjustmentsOf(db, [takerId], spans)
  const rows = db
    .select()
    .from(settlements)
    .where(eq(settlements.takerId, takerId))
    .orderBy(asc(settlements.settledAt), asc(settlements.id))
    .all()
  const mine = rows.filter((r) => r.periodId === periodId)
  const [record] = historyRecords(db, mine, new Map([[taker.id, taker.name]]), spans, adjusted)
  let carriedIn = 0
  let latestStart = ''
  for (const r of rows) {
    const start = spans.get(r.periodId)?.startsAt
    if (start === undefined || start >= span.startsAt || start < latestStart) continue
    latestStart = start
    carriedIn = r.carryOver
  }
  return {
    taker: { id: taker.id, name: taker.name },
    week: { periodId, startsAt: span.startsAt, endsAt: span.endsAt, levels: period.levels },
    record: record ?? null,
    carriedIn,
    items,
    adjustments: withinSpan(adjusted, takerId, span),
  }
}
