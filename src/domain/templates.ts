import type { Weekday } from './dates'
import { addPragueDays, fromPragueWallTime, startOfPragueDay, toPragueWallTime } from './dates'
import type { CopyDay, Deadline } from './lifecycle'
import type { Result } from './result'
import { fail, ok } from './result'

// What a recurring template defines besides its score (spec §5.3): an optional schedule and an
// optional deadline rule. This module checks that a definition makes sense; when a scheduled
// instance appears is `latestSlot` and `slotOutcome` (#39); when it is due is `instanceDeadline`.
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

/**
 * The latest schedule slot at or before `at`: one of `schedule.days` at `schedule.time`, or at
 * the start of the Prague day when `time` is null. Slot times follow the DST rules in `dates.ts`.
 */
export function latestSlot(schedule: TemplateSchedule, at: Date): Date {
  const today = startOfPragueDay(at)
  for (let back = 0; back <= 7; back++) {
    const day = toPragueWallTime(addPragueDays(today, -back))
    if (!schedule.days.includes(day.weekday)) continue
    const slot = fromPragueWallTime({
      year: day.year,
      month: day.month,
      day: day.day,
      hour: schedule.time?.hour ?? 0,
      minute: schedule.time?.minute ?? 0,
    })
    if (slot.getTime() <= at.getTime()) return slot
  }
  throw new RangeError('latestSlot: schedule has no days')
}

/** What a slot does: nothing, nothing but counts as handled, or makes an instance. */
export type SlotOutcome = 'none' | 'skip' | 'make'

/**
 * Whether a slot makes an instance (spec §5.3). Slots before the template was agreed, or not
 * after the last handled slot, do nothing. A slot of a template without a deadline is skipped
 * while an open or reserved instance of it still exists (no duplicates).
 */
export function slotOutcome(input: {
  slot: Date
  agreedAt: Date
  lastSlotAt: Date | null
  hasOpenInstance: boolean
  deadline: DeadlineRule | null
}): SlotOutcome {
  const slot = input.slot.getTime()
  if (slot < input.agreedAt.getTime()) return 'none'
  if (input.lastSlotAt && slot <= input.lastSlotAt.getTime()) return 'none'
  if (!input.deadline && input.hasOpenInstance) return 'skip'
  return 'make'
}

/** The Prague day an instant falls on, as a week copy's day (spec §5.12). */
export function copyDay(instant: Date): CopyDay {
  const startsAt = startOfPragueDay(instant)
  return { startsAt, endsAt: addPragueDays(startsAt, 1) }
}

/**
 * The slots a week plan makes copies for (spec §5.12): every slot `s` with `from <= s < until`
 * and after `lastSlotAt`, ascending. Of the slots at or before `at` only the latest is kept
 * (catch-up after downtime, spec §11). Slots are built per Prague calendar day, so a slot keeps
 * its wall-clock time across a DST change.
 */
export function weekSlots(input: {
  schedule: TemplateSchedule
  from: Date
  lastSlotAt: Date | null
  at: Date
  until: Date
}): Date[] {
  const { schedule, from, lastSlotAt, at, until } = input
  const slots: Date[] = []
  for (
    let day = startOfPragueDay(from);
    day.getTime() < until.getTime();
    day = addPragueDays(day, 1)
  ) {
    const w = toPragueWallTime(day)
    if (!schedule.days.includes(w.weekday)) continue
    const slot = fromPragueWallTime({
      year: w.year,
      month: w.month,
      day: w.day,
      hour: schedule.time?.hour ?? 0,
      minute: schedule.time?.minute ?? 0,
    })
    if (slot.getTime() < from.getTime() || slot.getTime() >= until.getTime()) continue
    if (lastSlotAt && slot.getTime() <= lastSlotAt.getTime()) continue
    slots.push(slot)
  }
  const past = slots.filter((s) => s.getTime() <= at.getTime())
  const future = slots.filter((s) => s.getTime() > at.getTime())
  return [...past.slice(-1), ...future]
}
