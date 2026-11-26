import type { DeadlineRule, TemplateSchedule } from '~/domain'
import type { Weekday } from '~/domain/dates'
import type { TemplateRow } from '~/server/db/schema'

// A template row's schedule and deadline rule as the domain's types. Kept apart from
// ./templates so the instance modules can read them without importing the template actions
// (which make week copies, #257: that import would be a cycle).

/** The weekdays of a stored `schedule_days` bit mask (bit d = weekday d, 0 = Sunday). */
export function maskToDays(mask: number): Weekday[] {
  const days: Weekday[] = []
  for (let d = 0; d <= 6; d++) if (mask & (1 << d)) days.push(d as Weekday)
  return days
}

/** The stored schedule as the domain's `TemplateSchedule`, or null when there is none. */
export function scheduleOf(row: TemplateRow): TemplateSchedule | null {
  if (row.scheduleDays === 0) return null
  const [hour = 0, minute = 0] = (row.scheduleTime ?? '').split(':').map(Number)
  return { days: maskToDays(row.scheduleDays), time: row.scheduleTime ? { hour, minute } : null }
}

/** A template row's deadline rule for the domain (`dueTime` is stored as "HH:MM"), or null. */
export function deadlineRuleOf(row: TemplateRow): DeadlineRule | null {
  if (row.dueDayOffset === null || row.dueTime === null || row.graceMinutes === null) return null
  const [hour = 0, minute = 0] = row.dueTime.split(':').map(Number)
  return { dayOffset: row.dueDayOffset, due: { hour, minute }, graceMinutes: row.graceMinutes }
}
