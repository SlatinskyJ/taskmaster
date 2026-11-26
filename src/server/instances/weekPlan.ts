import { and, eq, gt, inArray } from 'drizzle-orm'
import type { Weekday } from '~/domain/dates'
import { addPragueDays, startOfPragueDay, toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { tasks, templates, users } from '~/server/db/schema'
import type { TaskRow } from '~/server/db/schema'
import { currentPeriod } from '~/server/periods'
import { maskToDays } from '~/server/templates/rules'

// The plan table on Týden (#258, spec §5.12): the running period's days as columns, the agreed
// chores with schedule days as rows, and each day's week copies (`plan_day_at`, #257) as cells.
// Read-only: a tap reserves or releases through the task actions. The same table for a taker
// and a giver (the family plans on one board).

/** The states a week copy can be in (proposed and rejected never reach one). */
export const PLAN_COPY_STATUSES = [
  'open',
  'reserved',
  'done_unconfirmed',
  'confirmed',
  'expired',
  'cancelled',
] as const
export type PlanCopyStatus = (typeof PLAN_COPY_STATUSES)[number]

export interface PlanCopy {
  id: number
  status: PlanCopyStatus
  score: number
  origin: 'scheduled' | 'on_demand'
  /** UTC ISO: when the copy was made (an on-demand extra's time in the list sheet). */
  createdAt: string
  /** reserved: who holds it; done_unconfirmed / confirmed: who did it; open / expired / cancelled: null. */
  person: { id: number; name: string } | null
}

export interface PlanRow {
  templateId: number
  title: string
  /** The template's schedule weekdays (0 = Sunday), ascending. */
  scheduleDays: Weekday[]
  /** One entry per `WeekPlan.days`: that day's copies, oldest first (createdAt, then id). [] = blank. */
  cells: PlanCopy[][]
}

export interface WeekPlan {
  /** The running period; null before the first one (the table is empty). */
  period: { startsAt: string; cutoffAt: string } | null
  /** UTC ISO start of today's Prague day (past days and today's column are decided from it). */
  today: string
  /** UTC ISO start of each column's Prague day, in order. */
  days: string[]
  rows: PlanRow[]
}

/** The Prague day starts from the period's start day while they are before the cutoff. */
function periodDays(startsAt: Date, cutoffAt: Date): string[] {
  const days: string[] = []
  for (
    let d = startOfPragueDay(startsAt);
    d.getTime() < cutoffAt.getTime();
    d = addPragueDays(d, 1)
  )
    days.push(toIsoUtc(d))
  return days
}

/**
 * A start-day copy that reached its end before the period started belongs to the old week
 * (spec §5.12 [call] "only if a copy of it is still in the period"). Cancelled is final, so
 * `updatedAt` is when it was cancelled.
 */
function endedBefore(row: TaskRow, startsAt: string): boolean {
  switch (row.status) {
    case 'done_unconfirmed':
    case 'confirmed':
      return row.completedAt !== null && row.completedAt < startsAt
    case 'expired':
      return row.graceEndsAt !== null && row.graceEndsAt < startsAt
    case 'cancelled':
      return row.updatedAt < startsAt
    default:
      return false
  }
}

function personId(row: TaskRow): number | null {
  if (row.status === 'reserved') return row.reservedBy
  if (row.status === 'done_unconfirmed' || row.status === 'confirmed') return row.completedBy
  return null
}

const byAge = (a: TaskRow, b: TaskRow) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id

/** The plan table at `now`. */
export function getWeekPlan(db: Db | Tx, now: Date): WeekPlan {
  const today = toIsoUtc(startOfPragueDay(now))
  const period = currentPeriod(db, now)
  if (!period) return { period: null, today, days: [], rows: [] }
  const startsAt = toIsoUtc(period.startsAt)
  let days = periodDays(period.startsAt, period.cutoffAt)
  const chosen = db
    .select()
    .from(templates)
    .where(and(eq(templates.status, 'active'), gt(templates.scheduleDays, 0)))
    .all()
    .sort((a, b) => a.title.localeCompare(b.title, 'cs') || a.id - b.id)
  const ids = chosen.map((t) => t.id)
  const startDay = days[0]
  const copies = (
    ids.length === 0 || days.length === 0
      ? []
      : db
          .select()
          .from(tasks)
          .where(
            and(
              inArray(tasks.templateId, ids),
              inArray(tasks.planDayAt, days),
              inArray(tasks.status, PLAN_COPY_STATUSES),
              inArray(tasks.origin, ['scheduled', 'on_demand']),
            ),
          )
          .all()
  ).filter((r) => !(r.planDayAt === startDay && endedBefore(r, startsAt)))
  const midnight = startDay === startsAt
  if (!midnight && !copies.some((r) => r.planDayAt === startDay)) days = days.slice(1)
  const names = new Map(
    db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .all()
      .map((u) => [u.id, u.name]),
  )
  const toCopy = (r: TaskRow): PlanCopy => {
    const who = personId(r)
    return {
      id: r.id,
      status: r.status as PlanCopyStatus,
      score: r.score,
      origin: r.origin === 'on_demand' ? 'on_demand' : 'scheduled',
      createdAt: r.createdAt,
      person: who === null ? null : { id: who, name: names.get(who) ?? '' },
    }
  }
  const rows = chosen.map((t): PlanRow => {
    const mine = copies.filter((r) => r.templateId === t.id).sort(byAge)
    return {
      templateId: t.id,
      title: t.title,
      scheduleDays: maskToDays(t.scheduleDays),
      cells: days.map((d) => mine.filter((r) => r.planDayAt === d).map(toCopy)),
    }
  })
  return { period: { startsAt, cutoffAt: toIsoUtc(period.cutoffAt) }, today, days, rows }
}
