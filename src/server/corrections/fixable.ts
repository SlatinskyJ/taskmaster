import { and, desc, eq } from 'drizzle-orm'
import { effectiveSettlement, periodEnd } from '~/domain'
import type { Level } from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { disputes, periods, settlements } from '~/server/db/schema'
import { toPeriod } from '~/server/periods'
import { takerPointsNow, takersOf } from '~/server/settlement'
import { listPeople } from '~/server/users/people'
import { latestCorrections, toCorrection } from './read'

// What the admin's fix sheet picks from (#48, UI doc AFix): every boy with his confirmed total
// now and his settled weeks, newest first, with their effective level. The direct path lists
// the newest FIX_WEEKS_MAX; a week with an open dispute is listed whatever its age, so Opravit
// on Sporné always finds it. Admin only (the server function checks).

export const FIX_WEEKS_MAX = 8

export interface FixWeek {
  settlementId: number
  startsAt: string
  endsAt: string
  levels: { lower: number; upper: number }
  /** As settled: the total at the meeting and what was carried over. */
  totalBefore: number
  carryOver: number
  /** Effective: the latest correction's, else as settled. */
  level: Level
  deducted: number
  corrected: boolean
}

export interface FixTaker {
  id: number
  name: string
  /** Confirmed points now (the running total a removal is checked against). */
  total: number
  weeks: FixWeek[]
}

export function getFixable(db: Db | Tx): FixTaker[] {
  const totals = takerPointsNow(db)
  const disputed = new Set(
    db
      .select({ id: disputes.itemId })
      .from(disputes)
      .where(and(eq(disputes.itemKind, 'settlement'), eq(disputes.status, 'open')))
      .all()
      .map((d) => d.id),
  )
  return takersOf(db, listPeople(db)).map((t) => {
    const rows = db
      .select({ s: settlements, p: periods })
      .from(settlements)
      .innerJoin(periods, eq(periods.id, settlements.periodId))
      .where(eq(settlements.takerId, t.id))
      .orderBy(desc(periods.startsAt), desc(settlements.id))
      .all()
      .filter((r, i) => i < FIX_WEEKS_MAX || disputed.has(r.s.id))
    const latest = latestCorrections(
      db,
      rows.map((r) => r.s.id),
    )
    return {
      id: t.id,
      name: t.name,
      total: totals.get(t.id)?.confirmed ?? 0,
      weeks: rows.map(({ s, p }) => {
        const period = toPeriod(p)
        const correction = latest.get(s.id)
        const now = effectiveSettlement(s, correction ? toCorrection(s, correction) : null)
        return {
          settlementId: s.id,
          startsAt: toIsoUtc(period.startsAt),
          endsAt: toIsoUtc(periodEnd(period)),
          levels: period.levels,
          totalBefore: s.totalBefore,
          carryOver: s.carryOver,
          level: now.level,
          deducted: now.deducted,
          corrected: correction !== undefined,
        }
      }),
    }
  })
}
