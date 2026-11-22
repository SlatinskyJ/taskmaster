import type { Weekday } from './dates'
import { fromPragueWallTime, toPragueWallTime } from './dates'
import type { Deadline } from './lifecycle'
import type { Result } from './result'
import { fail, ok } from './result'

// What a recurring template defines besides its score (spec §5.3): an optional schedule and an
// optional deadline rule. This module only checks that a definition makes sense; when an
// instance actually appears is #39; when it is due is `instanceDeadline` below.
//
// Deadline rule (Jakub 2026-11-18): the due time is `dayOffset` Prague days after the instance
// appears, at the `due` clock time ("next day, 7:00"). If that moment has already passed when
// the instance appears, it moves one day later. Completion may still be logged for
// `graceMinutes` after the due time; then the instance expires.

/** A Prague wall-clock time of day. */
export interface ClockTime {
  /** 0–23 */
  hour: number
  /** 0–59 */
  minute: number
}

/**
 * When instances appear by themselves: on these weekdays (0 = Sunday … 6 = Saturday), at
 * `time`, or at the start of the Prague day when `time` is null ([call]).
 */
export interface TemplateSchedule {
  days: readonly Weekday[]
  time: ClockTime | null
}

export interface DeadlineRule {
  /** Whole Prague days after the instance appears, 0 (same day) to MAX_DUE_DAY_OFFSET. */
  dayOffset: number
  due: ClockTime
  /** How long completion may still be logged after the due time, 0 to MAX_GRACE_MINUTES. */
  graceMinutes: number
}

/** `schedule: null` = instances only on demand (#38); `deadline: null` = no deadline. */
export interface TemplateDefinition {
  schedule: TemplateSchedule | null
  deadline: DeadlineRule | null
}

export type TemplateDefinitionError = 'invalid_schedule' | 'invalid_deadline'

/** [call] A due time at most six days after the instance appears. */
export const MAX_DUE_DAY_OFFSET = 6
/** [call] Completion can be logged at most 48 hours after the due time. */
export const MAX_GRACE_MINUTES = 48 * 60

const inRange = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max

function isClockTime(t: ClockTime): boolean {
  return inRange(t.hour, 0, 23) && inRange(t.minute, 0, 59)
}

/** Checks a template's schedule and deadline rule; returns it with the days sorted and unique. */
export function validateTemplateDefinition(
  def: TemplateDefinition,
): Result<TemplateDefinition, TemplateDefinitionError> {
  let schedule: TemplateSchedule | null = null
  if (def.schedule) {
    const { days, time } = def.schedule
    if (days.length === 0 || !days.every((d) => inRange(d, 0, 6))) return fail('invalid_schedule')
    if (time && !isClockTime(time)) return fail('invalid_schedule')
    schedule = { days: [...new Set(days)].sort((a, b) => a - b), time }
  }
  const deadline = def.deadline
  if (
    deadline &&
    (!inRange(deadline.dayOffset, 0, MAX_DUE_DAY_OFFSET) ||
      !isClockTime(deadline.due) ||
      !inRange(deadline.graceMinutes, 0, MAX_GRACE_MINUTES))
  ) {
    return fail('invalid_deadline')
  }
  return ok({ schedule, deadline })
}

/**
 * When an instance that appears at `appearsAt` is due, and when its grace window ends. The due
 * day is built from the appearing day's date and `rule.due`, so a time inside a DST gap moves
 * forward on that day only. A due time at or before `appearsAt` moves one day later.
 */
export function instanceDeadline(rule: DeadlineRule, appearsAt: Date): Deadline {
  const day = toPragueWallTime(appearsAt)
  const dueOn = (offset: number) =>
    fromPragueWallTime({
      year: day.year,
      month: day.month,
      day: day.day + offset,
      hour: rule.due.hour,
      minute: rule.due.minute,
    })
  let dueAt = dueOn(rule.dayOffset)
  if (dueAt.getTime() <= appearsAt.getTime()) dueAt = dueOn(rule.dayOffset + 1)
  return { dueAt, graceEndsAt: new Date(dueAt.getTime() + rule.graceMinutes * 60_000) }
}
