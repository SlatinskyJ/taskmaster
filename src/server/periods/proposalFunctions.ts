import { createServerFn } from '@tanstack/react-start'
import type { PeriodDefaults, PeriodProposalStatus, PeriodSettings } from '~/domain'
import { LEVEL_MAX } from '~/lib/periodLimits'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import type { Db } from '~/server/db'
import { getFlags } from '~/server/features'
import { liveRead, serveLive } from '~/server/live'
import { int, parseDefaults, record } from './validators'
import {
  approveProposal,
  proposalsView,
  proposeDefaultsChange,
  proposePeriod,
  rejectProposal,
  withdrawProposal,
} from './proposals'
import type { ProposalError, ProposalKind, ProposalOutcome, ProposalsView } from './proposals'

// Server functions for proposals (#43, spec §5.8), behind the launch switch `periodProposals`:
// with it off every one answers `feature_off` and writes nothing, not only the hidden screens.
// Any party (giver or taker) proposes a per-period change and approves, rejects or withdraws;
// only a giver proposes new defaults (the domain checks that again). The admin is no party.

export type ProposalResult =
  { ok: true; status: PeriodProposalStatus } | { ok: false; error: ProposalError | 'feature_off' }

const OFF = { ok: false, error: 'feature_off' } as const
const isOn = (db: Db) => getFlags(db).periodProposals

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** Exactly `{ cutoffAt: ISO UTC with ms, levels: { lower, upper } }`, levels ≤ LEVEL_MAX. */
export function parsePeriodProposal(data: unknown): PeriodSettings {
  const d = record(data, ['cutoffAt', 'levels'])
  const levels = record(d.levels, ['lower', 'upper'])
  if (typeof d.cutoffAt !== 'string' || !ISO_UTC.test(d.cutoffAt)) throw new Error('Invalid input')
  const cutoffAt = new Date(d.cutoffAt)
  if (Number.isNaN(cutoffAt.getTime()) || cutoffAt.toISOString() !== d.cutoffAt) {
    throw new Error('Invalid input')
  }
  return {
    cutoffAt,
    levels: { lower: int(levels.lower, LEVEL_MAX), upper: int(levels.upper, LEVEL_MAX) },
  }
}

export interface ProposalRef {
  kind: ProposalKind
  id: number
}

/** Exactly `{ kind: 'period' | 'defaults', id }`. */
export function parseProposalRef(data: unknown): ProposalRef {
  const d = record(data, ['kind', 'id'])
  if (d.kind !== 'period' && d.kind !== 'defaults') throw new Error('Invalid input')
  return { kind: d.kind, id: int(d.id, Number.MAX_SAFE_INTEGER) }
}

const result = (r: ProposalOutcome): ProposalResult =>
  r.ok ? { ok: true, status: r.value.status } : { ok: false, error: r.error }

export function proposalsHandler(db: Db, now: Date): ProposalsView | { error: 'feature_off' } {
  return isOn(db) ? proposalsView(db, now) : { error: 'feature_off' }
}

export function proposePeriodHandler(
  db: Db,
  userId: number,
  settings: PeriodSettings,
  now: Date,
): ProposalResult {
  return isOn(db) ? result(proposePeriod(db, userId, settings, now)) : OFF
}

export function proposeDefaultsHandler(
  db: Db,
  giverId: number,
  defaults: PeriodDefaults,
  now: Date,
): ProposalResult {
  return isOn(db) ? result(proposeDefaultsChange(db, giverId, defaults, now)) : OFF
}

export function approveProposalHandler(db: Db, userId: number, ref: ProposalRef, now: Date) {
  return isOn(db) ? result(approveProposal(db, userId, ref.kind, ref.id, now)) : OFF
}

export function rejectProposalHandler(db: Db, userId: number, ref: ProposalRef, now: Date) {
  return isOn(db) ? result(rejectProposal(db, userId, ref.kind, ref.id, now)) : OFF
}

export function withdrawProposalHandler(db: Db, userId: number, ref: ProposalRef, now: Date) {
  return isOn(db) ? result(withdrawProposal(db, userId, ref.kind, ref.id, now)) : OFF
}

/** Switch off: nothing read, nothing subscribed. */
export const proposalsRead = liveRead({
  read: (db, _viewer, _arg: undefined, now) => proposalsHandler(db, now),
  topics: (_viewer, data) => ('error' in data ? [] : (['proposals'] as const)),
})

export const getProposalsFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }) => serveLive(proposalsRead, context.user, undefined))

export const proposePeriodFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parsePeriodProposal)
  .handler(({ data, context }) => proposePeriodHandler(getDb(), context.user.id, data, new Date()))

export const proposeDefaultsFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseDefaults)
  .handler(({ data, context }) =>
    proposeDefaultsHandler(getDb(), context.user.id, data, new Date()),
  )

export const approveProposalFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseProposalRef)
  .handler(({ data, context }) =>
    approveProposalHandler(getDb(), context.user.id, data, new Date()),
  )

export const rejectProposalFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseProposalRef)
  .handler(({ data, context }) => rejectProposalHandler(getDb(), context.user.id, data, new Date()))

export const withdrawProposalFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseProposalRef)
  .handler(({ data, context }) =>
    withdrawProposalHandler(getDb(), context.user.id, data, new Date()),
  )
