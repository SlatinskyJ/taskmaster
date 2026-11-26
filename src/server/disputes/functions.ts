import { createServerFn } from '@tanstack/react-start'
import type { Role } from '~/domain'
import { DISPUTE_NOTE_MAX, DISPUTE_REASON_MAX } from '~/lib/disputeLimits'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import { SETTLEMENT_LEVELS } from '~/server/db/schema'
import type { Db } from '~/server/db'
import { getFlags } from '~/server/features'
import { idTopic, liveRead, serveLive } from '~/server/live'
import type { Topic } from '~/server/live'
import { int, record } from '~/server/periods/validators'
import { dismissDisputeIn, disputeMarks, markKey, openDisputeIn } from './disputes'
import type { DisputeMark, DisputeServerError, OpenDisputeError } from './disputes'
import { listDisputes, listOpenForAdmin, seesItemDisputes } from './list'
import type { AdminDisputeEntry } from './list'
import type { DisputeValue } from './targets'

export type { DisputeItem, DisputeValue } from './targets'
export type { DisputeMark } from './disputes'
export type { AdminDisputeEntry, DisputeListEntry } from './list'
export type { DisputeServerError } from './disputes'
import type { DisputeListEntry } from './list'

// Server functions for disputes (spec §5.11), behind the launch switch `disputes`: with it off
// every one answers `feature_off` and writes nothing. Opening and marks (#46): takers and givers
// only; the admin is no party (the domain refuses it again). The admin's list and dismiss (#47):
// admin only (the domain checks the admin again).

/** What a taker or giver can dispute from a screen. */
export const OPENABLE_KINDS = [
  'task_score',
  'template_score',
  'completion',
  'rejection',
  'settlement',
  'adjustment',
] as const
export type OpenableKind = (typeof OPENABLE_KINDS)[number]

/** The items the task and template pages read a mark for. */
export const PAGE_MARK_KINDS = ['task_score', 'template_score', 'completion'] as const
export type PageMarkKind = (typeof PAGE_MARK_KINDS)[number]

const OFF = { ok: false, error: 'feature_off' } as const
const isOn = (db: Db) => getFlags(db).disputes

export function kindOf<K extends string>(value: unknown, kinds: readonly K[]): K {
  if (typeof value !== 'string' || !(kinds as readonly string[]).includes(value)) {
    throw new Error('Invalid input')
  }
  return value as K
}

export function positiveId(value: unknown): number {
  const id = int(value, Number.MAX_SAFE_INTEGER)
  if (id < 1) throw new Error('Invalid input')
  return id
}

export interface OpenDisputeInput {
  kind: OpenableKind
  id: number
  reason: string
}

/** Exactly `{ kind, id, reason }`; the reason at most DISPUTE_REASON_MAX after trimming. */
export function parseOpenDispute(data: unknown): OpenDisputeInput {
  const d = record(data, ['kind', 'id', 'reason'])
  if (typeof d.reason !== 'string' || d.reason.trim().length > DISPUTE_REASON_MAX) {
    throw new Error('Invalid input')
  }
  return { kind: kindOf(d.kind, OPENABLE_KINDS), id: positiveId(d.id), reason: d.reason }
}

/** Exactly `{ kind, id }` for a task score, a template score or a completion. */
export function parseItemMarkRef(data: unknown): { kind: PageMarkKind; id: number } {
  const d = record(data, ['kind', 'id'])
  return { kind: kindOf(d.kind, PAGE_MARK_KINDS), id: positiveId(d.id) }
}

export type OpenDisputeResult =
  { ok: true } | { ok: false; error: OpenDisputeError | 'feature_off' }

export function openDisputeHandler(
  db: Db,
  userId: number,
  input: OpenDisputeInput,
  now: Date,
): OpenDisputeResult {
  if (!isOn(db)) return OFF
  const r = openDisputeIn(db, userId, { kind: input.kind, id: input.id }, input.reason, now)
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

/** The item's mark, for a viewer who may see its disputes (a completion: its boy or opener). */
export function itemMarkHandler(
  db: Db,
  viewer: { id: number; role: Role },
  item: { kind: PageMarkKind; id: number },
): DisputeMark | null | { error: 'feature_off' } {
  if (!isOn(db)) return { error: 'feature_off' }
  if (!seesItemDisputes(db, viewer, item)) return null
  return disputeMarks(db, [item]).get(markKey(item)) ?? null
}

export function disputeListHandler(
  db: Db,
  viewer: { id: number; role: Role },
): DisputeListEntry[] | { error: 'feature_off' } {
  return isOn(db) ? listDisputes(db, viewer) : { error: 'feature_off' }
}

export const openDisputeFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseOpenDispute)
  .handler(({ data, context }) => openDisputeHandler(getDb(), context.user.id, data, new Date()))

export const getItemMarkFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseItemMarkRef)
  .handler(({ data, context }) =>
    itemMarkHandler(getDb(), { id: context.user.id, role: context.user.role }, data),
  )

/**
 * A giver sees every dispute; a taker those he opened, those about him and those about nobody
 * (a task's score). Switch off: nothing read, nothing subscribed.
 */
export const disputeListRead = liveRead({
  read: (db, viewer) => disputeListHandler(db, { id: viewer.id, role: viewer.role }),
  topics: (viewer, data): Topic[] => {
    if ('error' in data) return []
    if (viewer.role !== 'taker') return ['disputes']
    return [
      idTopic('disputes:by', viewer.id),
      idTopic('disputes:about', viewer.id),
      'disputes:about:none',
    ]
  },
})

export const getDisputeListFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }) => serveLive(disputeListRead, context.user, undefined))

/** An item's value as the admin saw it: null, `{ score }`, `{ points }` or a settlement's. */
export function parseSeenValue(data: unknown): DisputeValue | null {
  if (data === null) return null
  if (typeof data === 'object' && 'score' in data) {
    return { score: int(record(data, ['score']).score, Number.MAX_SAFE_INTEGER) }
  }
  if (typeof data === 'object' && 'points' in data) {
    return { points: int(record(data, ['points']).points, Number.MAX_SAFE_INTEGER) }
  }
  const d = record(data, ['level', 'deducted'])
  const deducted = int(d.deducted, Number.MAX_SAFE_INTEGER)
  if (deducted < 0) throw new Error('Invalid input')
  return { level: kindOf(d.level, SETTLEMENT_LEVELS), deducted }
}

export interface DismissDisputeInput {
  id: number
  /** The item's value the admin's list showed. */
  value: DisputeValue | null
  note: string
}

/** Exactly `{ id, value, note }`; the note at most DISPUTE_NOTE_MAX after trimming. */
export function parseDismissDispute(data: unknown): DismissDisputeInput {
  const d = record(data, ['id', 'value', 'note'])
  if (typeof d.note !== 'string' || d.note.trim().length > DISPUTE_NOTE_MAX) {
    throw new Error('Invalid input')
  }
  return { id: positiveId(d.id), value: parseSeenValue(d.value), note: d.note }
}

export type DismissDisputeResult =
  { ok: true } | { ok: false; error: DisputeServerError | 'feature_off' }

export function dismissDisputeHandler(
  db: Db,
  adminId: number,
  input: DismissDisputeInput,
  now: Date,
): DismissDisputeResult {
  if (!isOn(db)) return OFF
  const r = dismissDisputeIn(db, adminId, input.id, input.value, input.note, now)
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

export function adminDisputesHandler(db: Db): AdminDisputeEntry[] | { error: 'feature_off' } {
  return isOn(db) ? listOpenForAdmin(db) : { error: 'feature_off' }
}

export const dismissDisputeFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin')])
  .validator(parseDismissDispute)
  .handler(({ data, context }) => dismissDisputeHandler(getDb(), context.user.id, data, new Date()))

/** Every open dispute for Sporné; switch off: nothing read, nothing subscribed. */
export const adminDisputesRead = liveRead({
  read: (db) => adminDisputesHandler(db),
  topics: (_viewer, data): Topic[] => ('error' in data ? [] : ['disputes']),
})

export const getAdminDisputesFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('admin')])
  .handler(({ context }) => serveLive(adminDisputesRead, context.user, undefined))
