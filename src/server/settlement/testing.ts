import { fromPragueWallTime, toIsoUtc } from '~/domain/dates'
import { pointAdjustments, tasks } from '~/server/db/schema'
import type { TaskRow } from '~/server/db/schema'
import { getPeriodDefaults, listPeriods, rollPeriods } from '~/server/periods'
import { family } from '~/server/tasks/testing'
import type { Family } from '~/server/tasks/testing'

// Test helpers for the settlement modules. Not imported by app code.

export const prague = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  fromPragueWallTime({ year, month, day, hour, minute })
export const plus = (d: Date, ms: number) => new Date(d.getTime() + ms)

/** First roll: Sat 21 Nov 20:00 → P1 runs to Sun 29 Nov 23:59. */
export const SAT = prague(2026, 11, 21, 20)
export const CUTOFF = prague(2026, 11, 29, 23, 59)
export const MEETING = prague(2026, 11, 29, 20)

/** The family with P1 rolled at SAT. */
export function week() {
  const f = family()
  rollPeriods(f.db, SAT, getPeriodDefaults(f.db))
  const p1 = listPeriods(f.db)[0]
  if (!p1) throw new Error('no period')
  return { ...f, p1 }
}

/**
 * A task row written directly: done by `by` at `completedAt` (confirmed by default). The earner
 * is `by` when `by` is a taker of the family, else null ("bez bodů", or a giver did it).
 */
export function doneTask(
  f: Family,
  opts: {
    score: number
    completedAt: Date
    earner: number | null
    status?: TaskRow['status']
    reservedBy?: number | null
    updatedAt?: Date
  },
): number {
  const status = opts.status ?? 'confirmed'
  return f.db
    .insert(tasks)
    .values({
      title: 'Vyndat myčku',
      status,
      score: opts.score,
      approvalRequired: true,
      createdBy: f.tata,
      createdAt: toIsoUtc(SAT),
      updatedAt: toIsoUtc(opts.updatedAt ?? opts.completedAt),
      agreedAt: toIsoUtc(SAT),
      reservedBy: opts.reservedBy ?? opts.earner,
      reservedVia: 'tap',
      completedBy: opts.earner ?? f.tata,
      completedAt: toIsoUtc(opts.completedAt),
      earnerId: status === 'confirmed' || status === 'done_unconfirmed' ? opts.earner : null,
    })
    .returning()
    .get().id
}

/** A task reserved but not done yet. */
export function reservedTask(f: Family, by: number, score: number): number {
  return f.db
    .insert(tasks)
    .values({
      title: 'Vynést koš',
      status: 'reserved',
      score,
      approvalRequired: true,
      createdBy: f.tata,
      createdAt: toIsoUtc(SAT),
      updatedAt: toIsoUtc(SAT),
      agreedAt: toIsoUtc(SAT),
      reservedBy: by,
      reservedVia: 'tap',
    })
    .returning()
    .get().id
}

/** A manual point adjustment row written directly (by the admin, at `at`). */
export function adjustment(f: Family, takerId: number, points: number, at: Date): number {
  return f.db
    .insert(pointAdjustments)
    .values({ takerId, points, reason: 'Pomoc s nákupem.', madeBy: f.admin, madeAt: toIsoUtc(at) })
    .returning()
    .get().id
}
