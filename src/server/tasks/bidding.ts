import { eq } from 'drizzle-orm'
import { acceptLowestBid, acceptOneTimeOffer, counterOneTimeOffer, placeOneTimeBid } from '~/domain'
import type { Person } from '~/domain'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { toIsoUtc } from '~/domain/dates'
import { writeAudit } from '~/server/audit'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { taskScoreApprovals, tasks } from '~/server/db/schema'
import type { TaskRow } from '~/server/db/schema'
import { listPeople } from '~/server/users/people'
import type { AgreedOneTime, TaskError } from './tasks'
import { agree, agreementOf } from './tasks'
import { addEntry, openBids, openOffer } from './thread'

// Bidding on a one-time task (spec §5.2 path 2; Jakub 2026-11-17 and 2026-11-18). The rules live
// in src/domain/bidding.ts; each action here loads the task, asks the domain, and writes the
// thread rows, the task and the audit entries in one transaction.
//
// Who may call what (the domain checks it, live against current people):
// - placeBid: an active taker; a different number than the offer and his own open bid.
// - counterOffer: any active giver [call]; at exactly takers' open bids it accepts them.
// - acceptOffer: an active taker with an open bid; agreed and reserved to him.
// - acceptLowestTaskBid: any active giver [call]; the lowest open bid and its bidders as he saw them.

interface Ctx {
  tx: Tx
  task: TaskRow
  people: Person[]
}

function onTask(
  db: Db | Tx,
  taskId: number,
  run: (ctx: Ctx) => Result<TaskRow, TaskError>,
): Result<TaskRow, TaskError> {
  return db.transaction((tx) => {
    const task = tx.select().from(tasks).where(eq(tasks.id, taskId)).get()
    if (!task) return fail('not_found')
    return run({ tx, task, people: listPeople(tx) })
  })
}

/** The ids of the open bids at `score` held by `bidders` (the ones an agreement accepts). */
function bidsAt(tx: Tx, taskId: number, score: number, bidders: readonly number[]): number[] {
  return openBids(tx, taskId)
    .filter((b) => b.score === score && bidders.includes(b.userId))
    .map((b) => b.id)
}

function approve(
  tx: Tx,
  task: TaskRow,
  userId: number,
  offerRound: number,
  score: number,
  now: Date,
) {
  tx.insert(taskScoreApprovals)
    .values({ taskId: task.id, userId, offerRound, score, approvedAt: toIsoUtc(now) })
    .run()
}

/** A taker bids (or re-bids) on a proposed task. The task row is not touched. */
export function placeBid(
  db: Db | Tx,
  takerId: number,
  taskId: number,
  score: number,
  now: Date = new Date(),
): Result<TaskRow, TaskError> {
  return onTask(db, taskId, ({ tx, task, people }) => {
    const result = placeOneTimeBid(agreementOf(tx, task), people, takerId, score)
    if (!result.ok) return result
    const { entry, replaced } = addEntry(tx, { taskId, userId: takerId, side: 'taker', score }, now)
    writeAudit(tx, {
      actor: { kind: 'user', userId: takerId },
      action: 'task.bid_placed',
      entityType: 'task',
      entityId: taskId,
      before: replaced ? { entryId: replaced.id, score: replaced.score } : undefined,
      after: { entryId: entry.id, score },
      at: now,
    })
    return ok(task)
  })
}

/**
 * A giver counters with a new offer to every taker. `bidders` are the takers he saw bidding
 * exactly `score` (`[]` = none). With bidders it agrees their bids (Jakub 2026-11-18, decision
 * 8b); otherwise it is a new offer round with only his approval.
 */
export function counterOffer(
  db: Db | Tx,
  giverId: number,
  taskId: number,
  score: number,
  bidders: readonly number[],
  now: Date = new Date(),
): Result<TaskRow, TaskError> {
  return onTask(db, taskId, ({ tx, task, people }) => {
    const result = counterOneTimeOffer(agreementOf(tx, task), people, giverId, score, bidders)
    if (!result.ok) return result
    const actor = { kind: 'user', userId: giverId } as const
    if (result.value.status !== 'proposed') {
      return ok(acceptBids(tx, task, result.value, bidders, actor, now, { by: 'counter' }))
    }
    const old = openOffer(tx, taskId)
    const offerRound = task.offerRound + 1
    const saved = tx
      .update(tasks)
      .set({ score, offerRound, updatedAt: toIsoUtc(now) })
      .where(eq(tasks.id, taskId))
      .returning()
      .get()
    approve(tx, task, giverId, offerRound, score, now)
    const { entry } = addEntry(tx, { taskId, userId: giverId, side: 'giver', score }, now)
    writeAudit(tx, {
      actor,
      action: 'task.score_countered',
      entityType: 'task',
      entityId: taskId,
      before: { score: task.score, offerRound: task.offerRound, entryId: old.id },
      after: { score, offerRound, entryId: entry.id },
      at: now,
    })
    return ok(saved)
  })
}

/** A taker with an open bid accepts the current offer: agreed and reserved to him in one step. */
export function acceptOffer(
  db: Db | Tx,
  takerId: number,
  taskId: number,
  score: number,
  now: Date = new Date(),
): Result<TaskRow, TaskError> {
  return onTask(db, taskId, ({ tx, task, people }) => {
    const result = acceptOneTimeOffer(agreementOf(tx, task), people, takerId, score)
    if (!result.ok) return result
    if (result.value.status === 'proposed') throw new Error('an accepted offer is agreed')
    const offer = openOffer(tx, taskId)
    approve(tx, task, takerId, task.offerRound, score, now)
    const actor = { kind: 'user', userId: takerId } as const
    writeAudit(tx, {
      actor,
      action: 'task.score_approved',
      entityType: 'task',
      entityId: taskId,
      after: { score },
      at: now,
    })
    return ok(agree(tx, task, result.value, [offer.id], actor, now))
  })
}

/**
 * A giver accepts the lowest open bid. `score` and `bidders` are the lowest bid he saw and every
 * taker who held it. One bidder → reserved to him; a tie → open at that score.
 */
export function acceptLowestTaskBid(
  db: Db | Tx,
  giverId: number,
  taskId: number,
  score: number,
  bidders: readonly number[],
  now: Date = new Date(),
): Result<TaskRow, TaskError> {
  return onTask(db, taskId, ({ tx, task, people }) => {
    const result = acceptLowestBid(agreementOf(tx, task), people, giverId, score, bidders)
    if (!result.ok) return result
    if (result.value.status === 'proposed') throw new Error('an accepted bid is agreed')
    return ok(acceptBids(tx, task, result.value, bidders, { kind: 'user', userId: giverId }, now))
  })
}

/** Accepts the open bids at the agreed score held by `bidders`, then ends the negotiation. */
function acceptBids(
  tx: Tx,
  task: TaskRow,
  agreed: AgreedOneTime,
  bidders: readonly number[],
  actor: { kind: 'user'; userId: number },
  now: Date,
  extra: { by?: 'counter' } = {},
): TaskRow {
  const entryIds = bidsAt(tx, task.id, agreed.score, bidders)
  writeAudit(tx, {
    actor,
    action: 'task.bid_accepted',
    entityType: 'task',
    entityId: task.id,
    after: { score: agreed.score, entryIds, ...extra },
    at: now,
  })
  return agree(tx, task, agreed, entryIds, actor, now)
}
