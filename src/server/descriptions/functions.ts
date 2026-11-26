import { createServerFn } from '@tanstack/react-start'
import { requireRole } from '~/server/auth/guards'
import type { Result } from '~/domain/result'
import type { Db } from '~/server/db'
import { getDb } from '~/server/db'
import { getFlags } from '~/server/features'
import { liveRead, serveLive } from '~/server/live'
import { answerDescriptionChange, changeDescriptionOf } from './descriptions'
import { rawDescription } from './parse'
import { listDescriptionChangesWaiting } from './rows'
import type { DescriptionServerError, DescriptionTarget, DescriptionWaitingRow } from './rows'

// Server functions for descriptions (#207), behind the `descriptions` switch. Roles are checked
// here (guards) and again by the domain rules inside (`not_a_giver`, `not_a_taker`).

export type { DescriptionTarget, DescriptionWaitingRow, WaitingDescription } from './rows'

export type DescriptionOutcome = 'applied' | 'waiting' | 'withdrawn' | 'agreed' | 'declined'

export type DescriptionResult =
  | { ok: true; outcome: DescriptionOutcome }
  | { ok: false; error: DescriptionServerError | 'feature_off' }

function invalid(): never {
  throw new Error('Invalid input')
}

function record(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) invalid()
  return data as Record<string, unknown>
}

function targetOf(body: Record<string, unknown>): DescriptionTarget {
  const { kind, id } = body
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) invalid()
  if (kind === 'task') return { kind: 'task', id }
  if (kind === 'template') return { kind: 'template', id }
  return invalid()
}

/** A giver's new text for a task or a chore (a string up to the raw cap; blank = remove). */
export function parseDescriptionChange(data: unknown): {
  target: DescriptionTarget
  description: string
} {
  const body = record(data)
  return { target: targetOf(body), description: rawDescription(body.description) }
}

/** A taker's answer to the waiting change his page showed. */
export function parseDescriptionAnswer(data: unknown): {
  target: DescriptionTarget
  changeId: number
  yes: boolean
} {
  const body = record(data)
  const { changeId, yes } = body
  if (typeof changeId !== 'number' || !Number.isSafeInteger(changeId)) invalid()
  if (typeof yes !== 'boolean') invalid()
  return { target: targetOf(body), changeId, yes }
}

const OFF = { ok: false, error: 'feature_off' } as const

function answered(result: Result<DescriptionOutcome, DescriptionServerError>): DescriptionResult {
  return result.ok ? { ok: true, outcome: result.value } : { ok: false, error: result.error }
}

export function changeDescriptionHandler(
  db: Db,
  userId: number,
  data: ReturnType<typeof parseDescriptionChange>,
  now: Date,
): DescriptionResult {
  if (!getFlags(db).descriptions) return OFF
  return answered(changeDescriptionOf(db, data.target, userId, data.description, now))
}

export function answerDescriptionHandler(
  db: Db,
  userId: number,
  data: ReturnType<typeof parseDescriptionAnswer>,
  now: Date,
): DescriptionResult {
  if (!getFlags(db).descriptions) return OFF
  return answered(answerDescriptionChange(db, data.target, userId, data.changeId, data.yes, now))
}

/** A giver writes or changes a description (spec §5.1, §5.2). */
export const changeDescriptionFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseDescriptionChange)
  .handler(({ data, context }) =>
    changeDescriptionHandler(getDb(), context.user.id, data, new Date()),
  )

/** A taker OKs or turns down a waiting change. */
export const answerDescriptionFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('taker')])
  .validator(parseDescriptionAnswer)
  .handler(({ data, context }) =>
    answerDescriptionHandler(getDb(), context.user.id, data, new Date()),
  )

/** Domů: the waiting changes this brother may OK (ruling 6); none with the switch off. */
export function descriptionChangesWaitingHandler(db: Db, userId: number): DescriptionWaitingRow[] {
  return getFlags(db).descriptions ? listDescriptionChangesWaiting(db, userId) : []
}

export const descriptionChangesWaitingRead = liveRead({
  read: (db, viewer) => descriptionChangesWaitingHandler(db, viewer.id),
  // Switch off: nothing read, nothing subscribed.
  topics: (_viewer, _data, db) =>
    getFlags(db).descriptions ? (['tasks', 'templates'] as const) : [],
})

export const listDescriptionChangesWaitingFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('taker')])
  .handler(({ context }) => serveLive(descriptionChangesWaitingRead, context.user, undefined))
