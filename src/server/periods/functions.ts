import { createServerFn } from '@tanstack/react-start'
import type { PeriodDefaults } from '~/domain'
import type { Weekday } from '~/domain/dates'
import type { Result } from '~/domain/result'
import { LENGTH_WEEKS_MAX, LEVEL_MAX } from '~/lib/periodLimits'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import { getPeriodDefaults, plainDefaults, savePeriodDefaults } from './defaults'
import type { SetDefaultsError } from './defaults'

export type { SetDefaultsError }

// Server functions for the default week on Správa (#47). Admin only: the guard here, and the
// domain's `setDefaults` again inside (`not_admin`). The admin is always the signed-in user.

export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid input')
  }
  const r = value as Record<string, unknown>
  const own = Object.keys(r)
  if (own.length !== keys.length || !keys.every((k) => own.includes(k))) {
    throw new Error('Invalid input')
  }
  return r
}

export function int(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value > max) {
    throw new Error('Invalid input')
  }
  return value
}

/**
 * Exactly `{ lengthDays, cutoff: { weekday, hour, minute }, levels: { lower, upper } }`, safe
 * integers within the shared limits. The rest of the rules are the domain's (`isValidDefaults`).
 */
export function parseDefaults(data: unknown): PeriodDefaults {
  const d = record(data, ['lengthDays', 'cutoff', 'levels'])
  const cutoff = record(d.cutoff, ['weekday', 'hour', 'minute'])
  const levels = record(d.levels, ['lower', 'upper'])
  return {
    lengthDays: int(d.lengthDays, LENGTH_WEEKS_MAX * 7),
    cutoff: {
      // The domain refuses anything outside 0–6 (`invalid_settings`).
      weekday: int(cutoff.weekday, 6) as Weekday,
      hour: int(cutoff.hour, 23),
      minute: int(cutoff.minute, 59),
    },
    levels: { lower: int(levels.lower, LEVEL_MAX), upper: int(levels.upper, LEVEL_MAX) },
  }
}

/** What the screen gets: the defaults' fields, nothing else from the row. */
export const defaultsView = plainDefaults

export type SaveDefaultsResult = { ok: true } | { ok: false; error: SetDefaultsError }

export function saveResult(r: Result<PeriodDefaults, SetDefaultsError>): SaveDefaultsResult {
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

export const getPeriodDefaultsFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('admin')])
  .handler((): PeriodDefaults => defaultsView(getPeriodDefaults(getDb())))

export const savePeriodDefaultsFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin')])
  .validator(parseDefaults)
  .handler(({ data, context }) =>
    saveResult(savePeriodDefaults(getDb(), context.user.id, data, new Date())),
  )
