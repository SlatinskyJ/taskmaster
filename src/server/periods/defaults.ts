import { eq } from 'drizzle-orm'
import { DEFAULT_PERIOD_DEFAULTS, setDefaults } from '~/domain'
import type { PeriodDefaults, PeriodError } from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import type { Weekday } from '~/domain/dates'
import type { Result } from '~/domain/result'
import { ok } from '~/domain/result'
import { writeAudit } from '~/server/audit'
import type { Actor, Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { periodDefaults } from '~/server/db/schema'
import type { PeriodDefaultsRow } from '~/server/db/schema'
import { listPeople } from '~/server/users/people'
import { rollPeriods } from './periods'

// The stored default week (spec §5.8): one row, `period_defaults` id 1. Every new period takes
// the values stored at the moment it starts (the roller each tick, the settlement confirm inside
// its transaction); the running period never changes. Only the admin saves them directly here;
// #43 adds givers' proposals that apply through `writePeriodDefaults` once agreed.

type Reader = Db | Tx

const ROW_ID = 1

function toDefaults(row: PeriodDefaultsRow): PeriodDefaults {
  return {
    lengthDays: row.lengthDays,
    cutoff: {
      weekday: row.cutoffWeekday as Weekday,
      hour: row.cutoffHour,
      minute: row.cutoffMinute,
    },
    levels: { lower: row.lowerLevel, upper: row.upperLevel },
  }
}

/** Plain JSON for the audit log: exactly the defaults' fields. */
function toAudit(d: PeriodDefaults) {
  return {
    lengthDays: d.lengthDays,
    cutoff: { weekday: d.cutoff.weekday, hour: d.cutoff.hour, minute: d.cutoff.minute },
    levels: { lower: d.levels.lower, upper: d.levels.upper },
  }
}

function readRow(db: Reader): PeriodDefaultsRow | undefined {
  return db.select().from(periodDefaults).where(eq(periodDefaults.id, ROW_ID)).get()
}

/**
 * The default week in force now. The migration always seeds the row; without it (deleted by
 * hand) the code defaults apply, as a missing feature flag reads as off.
 */
export function getPeriodDefaults(db: Reader): PeriodDefaults {
  const row = readRow(db)
  return row ? toDefaults(row) : DEFAULT_PERIOD_DEFAULTS
}

/**
 * The one write path for the defaults. No role check: callers check (the admin here, an agreed
 * proposal in #43). First starts every period already due by `now` with the defaults stored
 * before this change, so a save between a cutoff and the roller's next tick never reaches a
 * period that has already started (spec §5.8). Then writes the row and its `settings.changed`
 * entry (`before` null when the row had to be recreated). Inside the caller's transaction.
 */
export function writePeriodDefaults(
  tx: Tx,
  actor: Actor,
  defaults: PeriodDefaults,
  now: Date,
): void {
  rollPeriods(tx, now, getPeriodDefaults(tx))
  const previous = readRow(tx)
  const values = {
    lengthDays: defaults.lengthDays,
    cutoffWeekday: defaults.cutoff.weekday,
    cutoffHour: defaults.cutoff.hour,
    cutoffMinute: defaults.cutoff.minute,
    lowerLevel: defaults.levels.lower,
    upperLevel: defaults.levels.upper,
    updatedAt: toIsoUtc(now),
    updatedBy: actor.kind === 'user' ? actor.userId : null,
  }
  tx.insert(periodDefaults)
    .values({ id: ROW_ID, ...values })
    .onConflictDoUpdate({ target: periodDefaults.id, set: values })
    .run()
  writeAudit(tx, {
    actor,
    action: 'settings.changed',
    entityType: 'settings',
    entityId: ROW_ID,
    before: previous ? toAudit(toDefaults(previous)) : null,
    after: toAudit(defaults),
    at: now,
  })
}

export type SetDefaultsError = PeriodError

/**
 * The admin changes the default week directly (spec §3, §5.8). Applies to periods that start
 * after `now`; the running one keeps its cutoff and levels. One transaction with its audit.
 */
export function savePeriodDefaults(
  db: Db,
  adminId: number,
  defaults: PeriodDefaults,
  now: Date,
): Result<PeriodDefaults, SetDefaultsError> {
  return db.transaction((tx) => {
    const checked = setDefaults(listPeople(tx), adminId, defaults)
    if (!checked.ok) return checked
    writePeriodDefaults(tx, { kind: 'user', userId: adminId }, checked.value, now)
    return ok(checked.value)
  })
}
