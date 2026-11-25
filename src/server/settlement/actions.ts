import { toIsoUtc } from '~/domain/dates'
import type { Period } from '~/domain'
import type { Result } from '~/domain/result'
import type { Db } from '~/server/db'
import type { SettlementRow } from '~/server/db/schema'
import { getFlags } from '~/server/features'
import { getMeeting, settlePeriod } from './meeting'
import type { Meeting, SettleError, ShownTotal } from './meeting'

// What the meeting server functions (./functions) do, so it is tested without the framework:
// they pass `getDb()`, the signed-in giver and `new Date()`, nothing else. Each reads the
// `settleLastDay` switch (#211) itself.

export type SettleResult =
  | {
      ok: true
      records: {
        takerId: number
        totalBefore: number
        level: SettlementRow['level']
        deducted: number
        carryOver: number
      }[]
      /** When the records were written (ISO UTC). */
      settledAt: string
      /** The week the confirm started, or null when the settled week had already ended. */
      next: { id: number; startsAt: string; cutoffAt: string; levels: Period['levels'] } | null
    }
  | { ok: false; error: SettleError }

/** What a confirm returns to the screen: the written records, their time and the next week. */
export function settled(
  result: Result<{ records: SettlementRow[]; next: Period | null }, SettleError>,
): SettleResult {
  if (!result.ok) return result
  const [first] = result.value.records
  // settlePeriod refuses `no_takers`, so a success always wrote at least one record.
  if (!first) throw new Error('settled without records')
  const { next } = result.value
  return {
    ok: true,
    records: result.value.records.map((r) => ({
      takerId: r.takerId,
      totalBefore: r.totalBefore,
      level: r.level,
      deducted: r.deducted,
      carryOver: r.carryOver,
    })),
    settledAt: first.settledAt,
    next: next && {
      id: next.id,
      startsAt: toIsoUtc(next.startsAt),
      cutoffAt: toIsoUtc(next.cutoffAt),
      levels: next.levels,
    },
  }
}

/** Schůzka now: the meeting with the switch as the database has it. */
export function meetingNow(db: Db, now: Date): Meeting {
  return getMeeting(db, now, getFlags(db).settleLastDay)
}

/** A giver confirms the settlement shown on Schůzka. */
export function settleNow(
  db: Db,
  giverId: number,
  data: { periodId: number; shown: ShownTotal[] },
  now: Date,
): SettleResult {
  return settled(
    settlePeriod(db, giverId, data.periodId, data.shown, now, getFlags(db).settleLastDay),
  )
}
