import { createServerFn } from '@tanstack/react-start'
import type { Role } from '~/domain'
import { DISPUTE_REASON_MAX } from '~/lib/disputeLimits'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import type { Db } from '~/server/db'
import { getFlags } from '~/server/features'
import { int, record } from '~/server/periods/validators'
import { disputeMarks, markKey, openDisputeIn } from './disputes'
import type { DisputeMark, OpenDisputeError } from './disputes'
import { listDisputes } from './list'
import type { DisputeListEntry } from './list'

// Server functions for disputes (#46, spec §5.11), behind the launch switch `disputes`: with it
// off every one answers `feature_off` and writes nothing. Takers and givers only; the admin is
// no party (the domain refuses it again).

/** What a taker or giver can dispute from a screen (`adjustment` comes with #48). */
export const OPENABLE_KINDS = [
  'task_score',
  'template_score',
  'completion',
  'rejection',
  'settlement',
] as const
export type OpenableKind = (typeof OPENABLE_KINDS)[number]

/** The items the task and template pages read a mark for. */
export const PAGE_MARK_KINDS = ['task_score', 'template_score', 'completion'] as const
export type PageMarkKind = (typeof PAGE_MARK_KINDS)[number]

const OFF = { ok: false, error: 'feature_off' } as const
const isOn = (db: Db) => getFlags(db).disputes

function kindOf<K extends string>(value: unknown, kinds: readonly K[]): K {
  if (typeof value !== 'string' || !(kinds as readonly string[]).includes(value)) {
    throw new Error('Invalid input')
  }
  return value as K
}

function positiveId(value: unknown): number {
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

export function itemMarkHandler(
  db: Db,
  item: { kind: PageMarkKind; id: number },
): DisputeMark | null | { error: 'feature_off' } {
  if (!isOn(db)) return { error: 'feature_off' }
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
  .handler(({ data }) => itemMarkHandler(getDb(), data))

export const getDisputeListFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }) =>
    disputeListHandler(getDb(), { id: context.user.id, role: context.user.role }),
  )
