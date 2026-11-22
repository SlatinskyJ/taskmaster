import type { PeriodDefaults } from '~/domain'
import type { Weekday } from '~/domain/dates'
import { LENGTH_WEEKS_MAX, LEVEL_MAX } from '~/lib/periodLimits'

// Input checks shared by the period server functions (./functions.ts, ./proposalFunctions.ts).

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
