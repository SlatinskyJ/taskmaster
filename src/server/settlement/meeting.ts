import { asc } from 'drizzle-orm'
import {
  findPerson,
  isActiveGiver,
  isRunning,
  periodEnd,
  periodToSettle,
  runningTotal,
  settle,
} from '~/domain'
import type {
  Level,
  Levels,
  Period,
  PeriodError,
  PeriodId,
  Person,
  SettlementError,
  SettlementRecord,
} from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { writeAudit } from '~/server/audit'
import type { Actor, Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { settlements, users } from '~/server/db/schema'
import type { SettlementRow } from '~/server/db/schema'
import { getFlags } from '~/server/features'
import { makeWeekCopies } from '~/server/instances'
import { endRunningPeriod, getPeriodDefaults, listPeriods } from '~/server/periods'
import { listPendingCompletions } from '~/server/tasks/tasks'
import type { TaskView } from '~/server/tasks/tasks'
import { listPeople } from '~/server/users/people'
import { ledgerEntries } from './ledger'

// The weekly meeting (spec §5.9): step 1 clears pending items, step 2 settles. Which week the
// meeting settles is the domain's `periodToSettle` (oldest unsettled ended week first, then the
// running one). Settling writes one final record per active taker; for the running week it
// also ends the week now and starts the next one (§5.8). One transaction for all of it.

export interface MeetingTaker {
  id: number
  name: string
  total: number
  level: Level
  deducted: number
  carryOver: number
}

export type Meeting =
  | {
      period: null
      /**
       * The running week's cutoff (ISO UTC) when only the last-day rule keeps it from the meeting
       * (#211): the screen says when the week ends. Null when there is nothing to settle at all.
       */
      runningCutoffAt: string | null
    }
  | {
      period: {
        id: number
        startsAt: string
        /** The week's end for its totals: now for the running week, else its end. */
        endsAt: string
        /** Where the week ends at the latest (the header shows it while the week runs). */
        cutoffAt: string
        running: boolean
        levels: Levels
      }
      /** Completions done before `endsAt` that still wait for a giver (step 1). */
      pending: TaskView[]
      /** What confirming would write, per active taker. */
      takers: MeetingTaker[]
    }

export type SettleError =
  | SettlementError
  | PeriodError
  | 'not_found'
  | 'nothing_to_settle'
  | 'wrong_period'
  | 'pending_items'
  | 'already_settled'
  | 'totals_changed'
  | 'no_takers'

export interface ShownTotal {
  takerId: number
  total: number
}

function settledIds(db: Db | Tx): Set<PeriodId> {
  return new Set(
    db
      .select({ periodId: settlements.periodId })
      .from(settlements)
      .all()
      .map((s) => s.periodId),
  )
}

/**
 * Whether an ended week still waits for its meeting (#48, ruling 8): the week the meeting would
 * settle next has ended. The running week never counts, so the last-day rule (#211) changes
 * nothing here: it is left off.
 */
export function weekWaiting(db: Db | Tx, now: Date): boolean {
  const target = periodToSettle(listPeriods(db), settledIds(db), now, false)
  return target !== undefined && !isRunning(target, now)
}

/** Active takers, by id, with their display names. Schůzka and Týden list the same people. */
export function takersOf(db: Db | Tx, people: readonly Person[]) {
  return db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .orderBy(asc(users.id))
    .all()
    .filter((u) => {
      const p = findPerson(people, u.id)
      return p?.role === 'taker' && p.active
    })
}

interface Preview {
  end: Date
  pending: TaskView[]
  records: (SettlementRecord & { name: string })[]
}

/** The totals and records for `target`, as of `now`. `settleBy` = any giver id for the preview. */
function preview(
  db: Db | Tx,
  people: readonly Person[],
  giverId: number,
  target: Period,
  now: Date,
): Result<Preview, SettlementError> {
  const end = isRunning(target, now) ? now : periodEnd(target)
  const pending = listPendingCompletions(db, { descriptions: getFlags(db).descriptions }).filter(
    (t) => t.completedAt !== null && t.completedAt < toIsoUtc(end),
  )
  const entries = ledgerEntries(db, end)
  const records: Preview['records'] = []
  for (const taker of takersOf(db, people)) {
    const total = runningTotal(entries, taker.id)
    const r = settle(people, giverId, target.id, taker.id, total, target.levels)
    if (!r.ok) return r
    records.push({ ...r.value, name: taker.name })
  }
  return ok({ end, pending, records })
}

/**
 * What the meeting screen shows now (read-only). `period: null` = nothing to settle; then
 * `runningCutoffAt` is set when the running week could be settled but for `lastDayOnly` (the
 * `settleLastDay` switch, #211: only on the week's last day).
 */
export function getMeeting(db: Db | Tx, now: Date, lastDayOnly: boolean): Meeting {
  const people = listPeople(db)
  const periods = listPeriods(db)
  const settled = settledIds(db)
  const target = periodToSettle(periods, settled, now, lastDayOnly)
  // The preview needs a giver for the domain's `settle`; with none there is nobody to settle.
  const giver = people.find(isActiveGiver)
  // No takers yet (accounts still being set up): nothing to settle, so no week is ended for it.
  if (!giver || takersOf(db, people).length === 0) return NOTHING
  if (!target) {
    const waiting = lastDayOnly ? periodToSettle(periods, settled, now, false) : undefined
    return { period: null, runningCutoffAt: waiting ? toIsoUtc(waiting.cutoffAt) : null }
  }
  const p = preview(db, people, giver.id, target, now)
  if (!p.ok) return NOTHING
  return {
    period: {
      id: target.id,
      startsAt: toIsoUtc(target.startsAt),
      endsAt: toIsoUtc(p.value.end),
      cutoffAt: toIsoUtc(target.cutoffAt),
      running: isRunning(target, now),
      levels: target.levels,
    },
    pending: p.value.pending,
    takers: p.value.records.map((r) => ({
      id: r.takerId,
      name: r.name,
      total: r.totalBefore,
      level: r.level,
      deducted: r.deducted,
      carryOver: r.carryOver,
    })),
  }
}

const NOTHING: Meeting = { period: null, runningCutoffAt: null }

function sameTotals(records: readonly SettlementRecord[], shown: readonly ShownTotal[]): boolean {
  if (records.length !== shown.length) return false
  return records.every((r) =>
    shown.some((s) => s.takerId === r.takerId && s.total === r.totalBefore),
  )
}

class Refused extends Error {
  constructor(readonly code: SettleError) {
    super(code)
  }
}

/**
 * The giver confirms step 2 for `periodId` with the totals the screen showed. Refused unless
 * that period is the one to settle now, nothing is pending before its end, and the totals are
 * unchanged. Writes a final record and a `settlement.created` audit entry per active taker; if
 * the week is still running, ends it now and starts the next one with the default week stored
 * at that moment (read inside this transaction). `lastDayOnly` (#211): the running week only on its
 * last day, else `nothing_to_settle`. Refused with `no_takers` while there is no active taker: settled
 * is read from the records, so a week settled with none would be offered again forever. One
 * transaction.
 */
export function settlePeriod(
  db: Db | Tx,
  giverId: number,
  periodId: number,
  shown: readonly ShownTotal[],
  now: Date,
  lastDayOnly: boolean,
): Result<{ period: Period; records: SettlementRow[]; next: Period | null }, SettleError> {
  try {
    return db.transaction((tx) => {
      const people = listPeople(tx)
      const giver = findPerson(people, giverId)
      if (!giver || !isActiveGiver(giver)) return fail('not_a_giver')
      const periods = listPeriods(tx)
      if (!periods.some((p) => p.id === periodId)) return fail('not_found')
      const settled = settledIds(tx)
      if (settled.has(periodId)) return fail('already_settled')
      const target = periodToSettle(periods, settled, now, lastDayOnly)
      if (!target) return fail('nothing_to_settle')
      if (target.id !== periodId) return fail('wrong_period')
      const p = preview(tx, people, giverId, target, now)
      if (!p.ok) return p
      if (p.value.records.length === 0) return fail('no_takers')
      if (p.value.pending.length > 0) return fail('pending_items')
      if (!sameTotals(p.value.records, shown)) return fail('totals_changed')
      const actor: Actor = { kind: 'user', userId: giverId }
      const records: SettlementRow[] = []
      for (const r of p.value.records) {
        const row = tx
          .insert(settlements)
          .values({
            periodId: target.id,
            takerId: r.takerId,
            totalBefore: r.totalBefore,
            level: r.level,
            deducted: r.deducted,
            carryOver: r.carryOver,
            settledBy: giverId,
            settledAt: toIsoUtc(now),
          })
          .returning()
          .get()
        writeAudit(tx, {
          actor,
          action: 'settlement.created',
          entityType: 'settlement',
          entityId: row.id,
          after: row,
          at: now,
        })
        records.push(row)
      }
      let next: Period | null = null
      let period = target
      if (isRunning(target, now)) {
        const ended = endRunningPeriod(tx, actor, target.id, now, getPeriodDefaults(tx))
        // Throwing rolls back the records written above.
        if (!ended.ok) throw new Refused(ended.error)
        next = ended.value.next
        period = ended.value.ended
        // The next week starts now: its copies are made with it (#257, spec §5.12).
        if (getFlags(tx).weekPlan) makeWeekCopies(tx, now)
      }
      return ok({ period, records, next })
    })
  } catch (err) {
    if (err instanceof Refused) return fail(err.code)
    throw err
  }
}
