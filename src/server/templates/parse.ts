import type { ClockTime, DeadlineRule, TemplateSchedule } from '~/domain'
import type { Weekday } from '~/domain/dates'
import { TASK_SCORE_MAX } from '~/lib/taskLimits'
import { TEMPLATE_STATUSES } from '~/server/db/schema'
import type { TemplateStatus } from '~/server/db/schema'
import { optionalDescription, seenDescriptionOf } from '~/server/descriptions/parse'
import type { NewTemplate } from './templates'

// Input checks for the template server functions: types and shape only, so nothing malformed
// reaches the domain. Ranges (days 0–6, hours, grace) are the domain's job
// (validateTemplateDefinition), so one rule decides them.

function invalid(): never {
  throw new Error('Invalid input')
}

function record(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) invalid()
  return data as Record<string, unknown>
}

function int(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid()
  return value
}

function clock(value: unknown): ClockTime {
  const { hour, minute } = record(value)
  return { hour: int(hour), minute: int(minute) }
}

function schedule(value: unknown): TemplateSchedule | null {
  if (value === null) return null
  const { days, time } = record(value)
  // At most one entry per weekday: an oversized array is refused before anything loops over it.
  if (!Array.isArray(days) || days.length > 7) invalid()
  return { days: days.map((d) => int(d) as Weekday), time: time === null ? null : clock(time) }
}

function deadline(value: unknown): DeadlineRule | null {
  if (value === null) return null
  const { dayOffset, due, graceMinutes } = record(value)
  return { dayOffset: int(dayOffset), due: clock(due), graceMinutes: int(graceMinutes) }
}

export function parseNewTemplate(data: unknown): NewTemplate {
  const body = record(data)
  const { title, score, approvalRequired } = body
  if (typeof title !== 'string' || typeof approvalRequired !== 'boolean') invalid()
  if (!('schedule' in body) || !('deadline' in body)) invalid()
  const description = optionalDescription(body)
  return {
    title,
    score: int(score),
    approvalRequired,
    schedule: schedule(body.schedule),
    deadline: deadline(body.deadline),
    ...(description !== undefined && { description }),
  }
}

/** A score a person sends: a whole number up to TASK_SCORE_MAX (the domain checks the floor). */
function scoreOf(value: unknown): number {
  const n = int(value)
  if (n > TASK_SCORE_MAX) invalid()
  return n
}

export function parseApproval(data: unknown): { templateId: number; score: number } {
  const { templateId, score } = record(data)
  return { templateId: int(templateId), score: scoreOf(score) }
}

/** The chore status a price call's page showed (#243); absent = not checked. */
export function seenStatusOf(body: Record<string, unknown>): { seenStatus?: TemplateStatus } {
  const seen = body.seenStatus
  if (seen === undefined) return {}
  if (!TEMPLATE_STATUSES.some((s) => s === seen)) invalid()
  return { seenStatus: seen as TemplateStatus }
}

/** A yes, bid or accept: the number, the text and the status the page showed (#207, #243). */
export function parseSeenScore(data: unknown): {
  templateId: number
  score: number
  seenDescription?: string | null
  seenStatus?: TemplateStatus
} {
  const body = record(data)
  return { ...parseApproval(body), ...seenDescriptionOf(body), ...seenStatusOf(body) }
}

/** A giver's counter or accept: the number, and the status his page showed (#243). */
export function parseSeenApproval(data: unknown): {
  templateId: number
  score: number
  seenStatus?: TemplateStatus
} {
  const body = record(data)
  return { ...parseApproval(body), ...seenStatusOf(body) }
}

/** Most bids a turn-down may name: more than any family has takers. */
const MAX_TURN_DOWN_BIDS = 20

/** A giver's turn-down on a proposed template: the open bids he saw, 1 to 20, one per taker. */
export function parseTemplateTurnDown(data: unknown): {
  templateId: number
  bids: { takerId: number; score: number }[]
} {
  const { templateId, bids } = record(data)
  if (!Array.isArray(bids) || bids.length < 1 || bids.length > MAX_TURN_DOWN_BIDS) invalid()
  const list = bids.map((b) => {
    const { takerId, score } = record(b)
    const n = scoreOf(score)
    // A bid is never below 1, so a seen bid of 0 is malformed, not a moved book.
    if (n < 1) invalid()
    return { takerId: int(takerId), score: n }
  })
  if (new Set(list.map((b) => b.takerId)).size !== list.length) invalid()
  return { templateId: int(templateId), bids: list }
}

export function parseTemplateId(data: unknown): { templateId: number } {
  const { templateId } = record(data)
  return { templateId: int(templateId) }
}
