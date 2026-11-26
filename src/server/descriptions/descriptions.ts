import { and, eq, isNull } from 'drizzle-orm'
import {
  answerDescription,
  changeDescription,
  normaliseDescription,
  taskDescriptionRule,
  templateDescriptionRule,
  waitingChangeAfter,
} from '~/domain'
import type { DescriptionError, DescriptionRule, Person } from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { writeAudit } from '~/server/audit'
import type { Actor, AuditAction, Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { descriptionChanges, tasks, templates } from '~/server/db/schema'
import type {
  DescriptionChangeClosing,
  DescriptionChangeRow,
  TaskRow,
  TemplateRow,
} from '~/server/db/schema'
import { resetOfferRound } from '~/server/tasks/bidding'
import { toItem } from '~/server/tasks/item'
import { resetTemplateOffer } from '~/server/templates/scoreChange'
import { listPeople } from '~/server/users/people'

// A task's or a chore's description (#207, spec §5.1–§5.3). The rules live in
// src/domain/description.ts; each write here loads the target, its waiting change and the
// people, asks the domain, and writes the rows and audit entries in one transaction.

export type DescriptionTarget = { kind: 'task'; id: number } | { kind: 'template'; id: number }

export type DescriptionServerError = DescriptionError | 'not_found' | 'no_change' | 'offer_changed'

export interface WaitingDescription {
  id: number
  /** The new text; null = removing the description. */
  description: string | null
  proposedBy: number
  createdAt: string
  /** Active takers whose OK would apply it, in people order (reserved: just the reserver). */
  waitingFor: number[]
}

type Loaded =
  | { kind: 'task'; row: TaskRow; rule: Result<DescriptionRule, DescriptionError> }
  | { kind: 'template'; row: TemplateRow; rule: Result<DescriptionRule, DescriptionError> }

function load(db: Db | Tx, target: DescriptionTarget): Loaded | null {
  if (target.kind === 'task') {
    const row = db.select().from(tasks).where(eq(tasks.id, target.id)).get()
    return row ? { kind: 'task', row, rule: taskDescriptionRule(toItem(row)) } : null
  }
  const row = db.select().from(templates).where(eq(templates.id, target.id)).get()
  if (!row) return null
  const status = row.status === 'active' ? 'agreed' : 'proposed'
  return { kind: 'template', row, rule: ok(templateDescriptionRule(status)) }
}

function openChange(db: Db | Tx, target: DescriptionTarget): DescriptionChangeRow | undefined {
  const column = target.kind === 'task' ? descriptionChanges.taskId : descriptionChanges.templateId
  return db
    .select()
    .from(descriptionChanges)
    .where(and(eq(column, target.id), isNull(descriptionChanges.closedAt)))
    .get()
}

function close(
  tx: Tx,
  id: number,
  as: DescriptionChangeClosing,
  by: number | null,
  now: Date,
): void {
  tx.update(descriptionChanges)
    .set({ closedAt: toIsoUtc(now), closedAs: as, closedBy: by })
    .where(eq(descriptionChanges.id, id))
    .run()
}

/** Sets the text in force; nothing else on the row changes. */
function setText(tx: Tx, target: DescriptionTarget, text: string | null): void {
  if (target.kind === 'task')
    tx.update(tasks).set({ description: text }).where(eq(tasks.id, target.id)).run()
  else tx.update(templates).set({ description: text }).where(eq(templates.id, target.id)).run()
}

type Event =
  'changed' | 'change_proposed' | 'change_approved' | 'change_declined' | 'change_withdrawn'

function log(
  tx: Tx,
  target: DescriptionTarget,
  event: Event,
  actor: Actor,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  now: Date,
): void {
  writeAudit(tx, {
    actor,
    action: `${target.kind}.description_${event}` as AuditAction,
    entityType: target.kind,
    entityId: target.id,
    before,
    after,
    at: now,
  })
}

/**
 * A proposed target: the text applies, and the agreement starts over at the same score with the
 * giver as offerer (ruling 7). One `*.description_changed` entry with the turn-down's keys.
 */
function applyWithReset(
  tx: Tx,
  loaded: Loaded,
  giverId: number,
  next: string | null,
  now: Date,
): void {
  const target = { kind: loaded.kind, id: loaded.row.id }
  setText(tx, target, next)
  const actor = { kind: 'user', userId: giverId } as const
  const before = { description: loaded.row.description, score: loaded.row.score }
  if (loaded.kind === 'task') {
    const { saved, entry, old, closedIds } = resetOfferRound(tx, loaded.row, giverId, now)
    log(
      tx,
      target,
      'changed',
      actor,
      { ...before, offerRound: loaded.row.offerRound, entryIds: closedIds, offerEntryId: old.id },
      { description: next, score: saved.score, offerRound: saved.offerRound, entryId: entry.id },
      now,
    )
    return
  }
  const { saved, entry, replacedOffer, closedIds } = resetTemplateOffer(
    tx,
    loaded.row,
    giverId,
    now,
  )
  log(
    tx,
    target,
    'changed',
    actor,
    { ...before, offerRound: loaded.row.offerRound, entryIds: closedIds, ...replacedOffer },
    { description: next, score: saved.score, offerRound: saved.offerRound, entryId: entry.id },
    now,
  )
}

/**
 * A giver writes a new description. Proposed → it applies at once (ruling 7 reset); agreed →
 * it waits for a taker's OK, replacing a waiting one; the text in force again → the waiting one
 * is withdrawn (ruling 5). `raw` is normalised first (ruling 6).
 */
export function changeDescriptionOf(
  db: Db | Tx,
  target: DescriptionTarget,
  giverId: number,
  raw: string,
  now: Date = new Date(),
): Result<'applied' | 'waiting' | 'withdrawn', DescriptionServerError> {
  const next = normaliseDescription(raw)
  if (!next.ok) return next
  return db.transaction((tx) => {
    const loaded = load(tx, target)
    if (!loaded) return fail('not_found')
    if (!loaded.rule.ok) return loaded.rule
    const current = loaded.row.description
    const pending = openChange(tx, target)
    const people = listPeople(tx)
    const result = changeDescription(
      loaded.rule.value,
      current,
      pending ? pending.description : undefined,
      people,
      giverId,
      next.value,
    )
    if (!result.ok) return result
    const actor = { kind: 'user', userId: giverId } as const
    if (result.value === 'apply') {
      applyWithReset(tx, loaded, giverId, next.value, now)
      return ok('applied')
    }
    // Unreachable: withdraw needs a waiting change (the domain checked it).
    if (result.value === 'withdraw') {
      if (!pending) throw new Error('a withdrawn description change is open')
      close(tx, pending.id, 'withdrawn', giverId, now)
      log(
        tx,
        target,
        'change_withdrawn',
        actor,
        { description: pending.description, changeId: pending.id },
        { description: current },
        now,
      )
      return ok('withdrawn')
    }
    if (pending) close(tx, pending.id, 'replaced', giverId, now)
    const change = tx
      .insert(descriptionChanges)
      .values({
        taskId: target.kind === 'task' ? target.id : null,
        templateId: target.kind === 'template' ? target.id : null,
        description: next.value,
        proposedBy: giverId,
        createdAt: toIsoUtc(now),
      })
      .returning()
      .get()
    log(
      tx,
      target,
      'change_proposed',
      actor,
      { description: current },
      {
        description: next.value,
        changeId: change.id,
        ...(pending && { replacedId: pending.id }),
      },
      now,
    )
    return ok('waiting')
  })
}

/**
 * A taker answers the waiting change `changeId` (the one his page showed): yes applies it, no
 * closes it. Who may answer follows the target's state now (ruling 3).
 */
export function answerDescriptionChange(
  db: Db | Tx,
  target: DescriptionTarget,
  takerId: number,
  changeId: number,
  yes: boolean,
  now: Date = new Date(),
): Result<'agreed' | 'declined', DescriptionServerError> {
  return db.transaction((tx) => {
    const loaded = load(tx, target)
    if (!loaded) return fail('not_found')
    const pending = openChange(tx, target)
    if (!pending) return fail('no_change')
    if (pending.id !== changeId) return fail('offer_changed')
    if (!loaded.rule.ok) return loaded.rule
    const result = answerDescription(loaded.rule.value, listPeople(tx), takerId)
    if (!result.ok) return result
    const actor = { kind: 'user', userId: takerId } as const
    const current = loaded.row.description
    if (yes) {
      setText(tx, target, pending.description)
      close(tx, pending.id, 'agreed', takerId, now)
      log(
        tx,
        target,
        'change_approved',
        actor,
        { description: current, changeId },
        { description: pending.description, changeId },
        now,
      )
      return ok('agreed')
    }
    close(tx, pending.id, 'declined', takerId, now)
    log(
      tx,
      target,
      'change_declined',
      actor,
      { description: pending.description, changeId },
      { description: current },
      now,
    )
    return ok('declined')
  })
}

function waitingFor(rule: DescriptionRule, people: readonly Person[]): number[] {
  if (rule.kind === 'direct') return []
  return people
    .filter((p) => p.active && p.role === 'taker')
    .filter((p) => rule.kind === 'any_taker' || p.id === rule.takerId)
    .map((p) => p.id)
}

/** The target's waiting change and who may OK it, or null. */
export function waitingDescriptionOf(
  db: Db | Tx,
  target: DescriptionTarget,
): WaitingDescription | null {
  const pending = openChange(db, target)
  if (!pending) return null
  const loaded = load(db, target)
  const rule = loaded?.rule
  return {
    id: pending.id,
    description: pending.description,
    proposedBy: pending.proposedBy,
    createdAt: pending.createdAt,
    waitingFor: rule?.ok ? waitingFor(rule.value, listPeople(db)) : [],
  }
}

/**
 * Lifecycle caller duty (rulings 1–3), in the step's transaction after it saved `row`: open or
 * reserved keeps a waiting change; back to proposed applies it (nobody's OK is needed there);
 * done, cancelled or expired discards it. Logged after the step, as its actor. Returns the row.
 */
export function settleStaleDescription(tx: Tx, row: TaskRow, actor: Actor, now: Date): TaskRow {
  const target = { kind: 'task', id: row.id } as const
  const pending = openChange(tx, target)
  if (!pending) return row
  const what = waitingChangeAfter(toItem(row))
  if (what === 'keep') return row
  const by = actor.kind === 'user' ? actor.userId : null
  if (what === 'apply') {
    setText(tx, target, pending.description)
    close(tx, pending.id, 'applied', by, now)
    log(
      tx,
      target,
      'changed',
      actor,
      { description: row.description, changeId: pending.id },
      { description: pending.description, changeId: pending.id },
      now,
    )
    return { ...row, description: pending.description }
  }
  close(tx, pending.id, 'discarded', by, now)
  writeAudit(tx, {
    actor,
    action: 'task.description_change_discarded',
    entityType: 'task',
    entityId: row.id,
    after: { changeId: pending.id, description: pending.description },
    at: now,
  })
  return row
}
