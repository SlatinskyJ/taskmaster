import { eq, inArray } from 'drizzle-orm'
import {
  acceptLowestBid,
  acceptOneTimeOffer,
  counterOneTimeOffer,
  isActiveAs,
  placeOneTimeBid,
  turnDownOneTimeBids,
  withdrawOneTimeBid,
} from '~/domain'
import type { Person } from '~/domain'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { toIsoUtc } from '~/domain/dates'
import { writeAudit } from '~/server/audit'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { taskScoreApprovals, tasks } from '~/server/db/schema'
import type { TaskRow, ThreadRow } from '~/server/db/schema'
import { listPeople } from '~/server/users/people'
import type { AgreedOneTime, TaskError } from './tasks'
import { agree, agreementOf } from './tasks'
import { addEntry, openBids, openOffer } from './thread'
import { taskThread } from '~/server/db/schema'

// Bidding on a one-time task (spec §5.2 path 2; Jakub 2026-11-17 and 2026-11-18). The rules live
// in src/domain/bidding.ts; each action here loads the task, asks the domain, and writes the
// thread rows, the task and the audit entries in one transaction.
//
// Who may call what (the domain checks it, live against current people):
// - placeBid: an active taker; not the offer, nor his previous bid since the last offer change.
// - counterOffer: any active giver [call]; at exactly takers' open bids it accepts them.
// - acceptOffer: an active taker with an open bid; agreed and reserved to him.
// - acceptLowestTaskBid: any active giver [call]; the lowest open bid and its bidders as he saw them.
// - withdrawBid: an active taker with an open bid (Nechci); turnDownBids: any active giver, the
//   bids as he saw them (Jakub 2026-11-24).

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

/**
 * The open bids an agreement accepts: the winner's bid when reserved, every current taker's bid
 * at the agreed score when open (a tie). Taken from the domain's result, never from the request.
 */
function bidsAgreed(tx: Tx, task: TaskRow, people: Person[], agreed: AgreedOneTime): number[] {
  return openBids(tx, task.id)
    .filter((b) => b.score === agreed.score)
    .filter((b) =>
      agreed.status === 'reserved'
        ? b.userId === agreed.takerId
        : isActiveAs(people, b.userId, 'taker'),
    )
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
      // The counter goes into the thread too (spec §5.2: every bid and counter), accepted with
      // the bids at its number.
      const { entry, replaced } = addEntry(
        tx,
        { taskId, userId: giverId, side: 'giver', score },
        now,
      )
      const counter = { entryId: entry.id, replaced }
      return ok(acceptBids(tx, { task, people }, result.value, actor, now, counter))
    }
    const { saved, entry, old } = newOfferRound(tx, task, giverId, score, now)
    const { offerRound } = saved
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

/**
 * A new offer round by a giver: his offer row (the old one closes `replaced`), the task's score
 * and round, and his approval. Shared by a counter and a turn-down, so the two writers of an offer
 * round can't drift apart (the score is stored twice, see `agreementOf`).
 */
function newOfferRound(
  tx: Tx,
  task: TaskRow,
  giverId: number,
  score: number,
  now: Date,
): { saved: TaskRow; entry: ThreadRow; old: ThreadRow } {
  const old = openOffer(tx, task.id)
  const offerRound = task.offerRound + 1
  const saved = tx
    .update(tasks)
    .set({ score, offerRound, updatedAt: toIsoUtc(now) })
    .where(eq(tasks.id, task.id))
    .returning()
    .get()
  approve(tx, task, giverId, offerRound, score, now)
  const { entry } = addEntry(tx, { taskId: task.id, userId: giverId, side: 'giver', score }, now)
  return { saved, entry, old }
}

/** A taker says no (Nechci, Jakub 2026-11-24): his open bid closes, other bids stay. */
export function withdrawBid(
  db: Db | Tx,
  takerId: number,
  taskId: number,
  now: Date = new Date(),
): Result<TaskRow, TaskError> {
  return onTask(db, taskId, ({ tx, task, people }) => {
    const result = withdrawOneTimeBid(agreementOf(tx, task), people, takerId)
    if (!result.ok) return result
    const bid = openBids(tx, taskId).find((b) => b.userId === takerId)
    if (!bid) throw new Error('a withdrawn bid is open')
    closeRows(tx, [bid.id], now)
    writeAudit(tx, {
      actor: { kind: 'user', userId: takerId },
      action: 'task.bid_withdrawn',
      entityType: 'task',
      entityId: taskId,
      before: { entryId: bid.id, score: bid.score },
      at: now,
    })
    return ok(task)
  })
}

/**
 * A giver turns the bidding down (Jakub 2026-11-24): every open bid closes and he offers the
 * current score again, a new round (previous bids no longer block a number). `seen` are the bids
 * he saw; if they changed meanwhile, it is `offer_changed` and nothing closes.
 */
export function turnDownBids(
  db: Db | Tx,
  giverId: number,
  taskId: number,
  seen: readonly { takerId: number; score: number }[],
  now: Date = new Date(),
): Result<TaskRow, TaskError> {
  return onTask(db, taskId, ({ tx, task, people }) => {
    const book = seen.map((b) => ({ by: b.takerId, score: b.score }))
    const result = turnDownOneTimeBids(agreementOf(tx, task), people, giverId, book)
    if (!result.ok) return result
    const bids = openBids(tx, taskId)
    closeRows(
      tx,
      bids.map((b) => b.id),
      now,
    )
    const { saved, entry, old } = newOfferRound(tx, task, giverId, task.score, now)
    writeAudit(tx, {
      actor: { kind: 'user', userId: giverId },
      action: 'task.bids_turned_down',
      entityType: 'task',
      entityId: taskId,
      before: {
        score: task.score,
        offerRound: task.offerRound,
        entryIds: bids.map((b) => b.id),
        offerEntryId: old.id,
      },
      after: { score: saved.score, offerRound: saved.offerRound, entryId: entry.id },
      at: now,
    })
    return ok(saved)
  })
}

function closeRows(tx: Tx, ids: readonly number[], now: Date) {
  if (ids.length === 0) return
  tx.update(taskThread)
    .set({ closedAt: toIsoUtc(now), closedAs: 'closed' })
    .where(inArray(taskThread.id, [...ids]))
    .run()
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
    return ok(
      acceptBids(tx, { task, people }, result.value, { kind: 'user', userId: giverId }, now),
    )
  })
}

/**
 * Accepts the bids the domain agreed, then ends the negotiation. A counter at a bid passes its
 * own new offer row, which is accepted with them.
 */
function acceptBids(
  tx: Tx,
  { task, people }: { task: TaskRow; people: Person[] },
  agreed: AgreedOneTime,
  actor: { kind: 'user'; userId: number },
  now: Date,
  counter?: { entryId: number; replaced: ThreadRow | null },
): TaskRow {
  const entryIds = bidsAgreed(tx, task, people, agreed)
  const old = counter?.replaced
  writeAudit(tx, {
    actor,
    action: 'task.bid_accepted',
    entityType: 'task',
    entityId: task.id,
    // A counter at a bid replaced the offer: `before` names that row (spec §5.10).
    before: old ? { entryId: old.id, score: old.score } : undefined,
    after: counter
      ? { score: agreed.score, entryIds, by: 'counter', offerEntryId: counter.entryId }
      : { score: agreed.score, entryIds },
    at: now,
  })
  const accepted = counter ? [...entryIds, counter.entryId] : entryIds
  return agree(tx, task, agreed, accepted, actor, now)
}
