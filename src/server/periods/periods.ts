import { and, asc, desc, eq, isNull, lte } from 'drizzle-orm'
import { endPeriodEarly, firstPeriod, isRunning, periodAt, periodsToStart } from '~/domain'
import type { Levels, Period, PeriodDefaults, PeriodError, PeriodId, PeriodSpan } from '~/domain'
import { parseIsoUtc, toIsoUtc } from '~/domain/dates'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { writeAudit } from '~/server/audit'
import type { Actor, Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { periods } from '~/server/db/schema'
import type { PeriodRow } from '~/server/db/schema'

// Stored periods (spec §5.8). The chain rules live in src/domain/periods.ts; this module stores
// them. Two paths start a period, each with its audit entries in one transaction:
//   - `rollPeriods` (the roller, ./roller.ts): the first period, then one at every cutoff that
//     has passed, catching up after downtime;
//   - `endRunningPeriod` (the meeting's settlement, #44): settling ends the running period now
//     and starts the next one.
//
// Per-period proposals (#43) are not stored yet: both paths pass `null`. #43 owns reading the
// agreed proposal on both paths, lapsing pending ones when their period starts (at either path),
// and refusing approvals after that. The defaults are a required parameter on purpose: when #43
// or #47 store settings, the type checker lists every caller.

type Reader = Db | Tx

/** A stored row as a domain period. */
export function toPeriod(row: PeriodRow): Period {
  return {
    id: row.id,
    startsAt: parseIsoUtc(row.startsAt),
    cutoffAt: parseIsoUtc(row.cutoffAt),
    endedAt: row.endedAt === null ? null : parseIsoUtc(row.endedAt),
    levels: { lower: row.lowerLevel, upper: row.upperLevel },
  }
}

/** Every period, oldest first. */
export function listPeriods(db: Reader): Period[] {
  return db.select().from(periods).orderBy(asc(periods.startsAt)).all().map(toPeriod)
}

function latestPeriod(db: Reader): Period | undefined {
  const row = db.select().from(periods).orderBy(desc(periods.startsAt)).limit(1).get()
  return row ? toPeriod(row) : undefined
}

/**
 * The period running at `now` (startsAt ≤ now < its end), if any: the last one that started by
 * `now`. None before the first roll, and none in the moment between a cutoff and its roll.
 * Read-only.
 */
export function currentPeriod(db: Reader, now: Date): Period | undefined {
  const row = db
    .select()
    .from(periods)
    .where(lte(periods.startsAt, toIsoUtc(now)))
    .orderBy(desc(periods.startsAt))
    .limit(1)
    .get()
  const period = row ? toPeriod(row) : undefined
  return period && isRunning(period, now) ? period : undefined
}

/**
 * The levels points are shown against now: the running period's. With no running period (before
 * the first roll, or between a cutoff and its roll tick) the defaults, which is what the next
 * period gets until #43 adds agreed changes.
 */
export function currentLevels(db: Reader, now: Date, defaults: PeriodDefaults): Levels {
  return currentPeriod(db, now)?.levels ?? defaults.levels
}

/** The period an instant (a completion's `completed_at`, spec §5.5) belongs to, if any. */
export function periodAtInstant(db: Reader, instant: Date): Period | undefined {
  return periodAt(listPeriods(db), instant)
}

type Cause = 'first' | 'cutoff' | 'settled'

function insertPeriod(tx: Tx, span: PeriodSpan, cause: Cause, actor: Actor, now: Date): Period {
  const row = tx
    .insert(periods)
    .values({
      startsAt: toIsoUtc(span.startsAt),
      cutoffAt: toIsoUtc(span.cutoffAt),
      endedAt: null,
      lowerLevel: span.levels.lower,
      upperLevel: span.levels.upper,
      createdAt: toIsoUtc(now),
    })
    .returning()
    .get()
  const period = toPeriod(row)
  writeAudit(tx, {
    actor,
    action: 'period.created',
    entityType: 'period',
    entityId: period.id,
    after: {
      startsAt: row.startsAt,
      cutoffAt: row.cutoffAt,
      levels: period.levels,
      cause,
    },
    at: now,
  })
  return period
}

/**
 * Creates the periods that are due by `now`: the first one if there is none yet (it starts
 * `now`), then one per cutoff that has passed, oldest first. Idempotent: returns `[]` when
 * nothing is due. One transaction, so a failed audit write leaves no period behind.
 */
export function rollPeriods(db: Db | Tx, now: Date, defaults: PeriodDefaults): Period[] {
  return db.transaction((tx) => {
    const system: Actor = { kind: 'system' }
    const created: Period[] = []
    let latest = latestPeriod(tx)
    if (!latest) {
      latest = insertPeriod(tx, firstPeriod(now, defaults), 'first', system, now)
      created.push(latest)
    }
    for (const span of periodsToStart(latest, now, defaults, null)) {
      created.push(insertPeriod(tx, span, 'cutoff', system, now))
    }
    return created
  })
}

export type EndPeriodError = PeriodError | 'not_found'

/**
 * Settling ends the running period now (spec §5.8). Runs inside the caller's transaction (the
 * settlement, #44). `periodId` = the period being settled: refused (`not_running`) unless that
 * exact period is still running, so a retried confirm or a confirm after the cutoff's roll never
 * ends the new period. No role check here: the caller checks the giver (domain `settle`).
 */
export function endRunningPeriod(
  tx: Tx,
  actor: Actor,
  periodId: PeriodId,
  now: Date,
  defaults: PeriodDefaults,
): Result<{ ended: Period; next: Period }, EndPeriodError> {
  const row = tx.select().from(periods).where(eq(periods.id, periodId)).get()
  if (!row) return fail('not_found')
  // Refused unless this period is still running and is the latest one. The second check matters
  // when `now` was read just before the cutoff but the roller has already started the next
  // period: ending this one would insert a period overlapping it.
  if (latestPeriod(tx)?.id !== periodId) return fail('not_running')
  const step = endPeriodEarly(toPeriod(row), now, defaults, null)
  if (!step.ok) return step
  const endedAt = toIsoUtc(now)
  tx.update(periods)
    .set({ endedAt })
    .where(and(eq(periods.id, periodId), isNull(periods.endedAt)))
    .run()
  writeAudit(tx, {
    actor,
    action: 'period.ended',
    entityType: 'period',
    entityId: periodId,
    before: { endedAt: null },
    after: { endedAt },
    at: now,
  })
  const next = insertPeriod(tx, step.value.next, 'settled', actor, now)
  return ok({ ended: { ...toPeriod(row), endedAt: now }, next })
}
