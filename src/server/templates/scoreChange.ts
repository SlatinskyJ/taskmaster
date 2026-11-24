import { and, eq } from 'drizzle-orm'
import {
  acceptLowestProposedTemplateBid,
  acceptLowestTemplateBid,
  acceptProposedTemplateOffer,
  acceptTemplateOffer,
  bidTemplateScore,
  counterProposedTemplate,
  counterTemplateScore,
  isActiveAs,
  placeProposedTemplateBid,
  turnDownProposedTemplateBids,
  turnDownTemplateChangeBids,
  withdrawProposedTemplateBid,
  withdrawTemplateChangeBid,
} from '~/domain'
import type { Person, TemplateAgreement } from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { writeAudit } from '~/server/audit'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { templates } from '~/server/db/schema'
import type { TemplateRow, TemplateThreadRow } from '~/server/db/schema'
import { listPeople } from '~/server/users/people'
import type { AgreedBy, BiddingOpts, TemplateError } from './templates'
import { agreeIn, agreementOf, approveIn, offerRowIds } from './templates'
import { addEntry, closeRows, closeThread, markBidsFrom, openRows } from './thread'

// Changing the score of an agreed template (spec §5.1: runs like bidding, §5.2; Jakub
// 2026-11-17/18). The rules live in src/domain/scoreChange.ts; each action loads the template,
// asks the domain, and writes the thread rows, the score and the audit entries in one
// transaction. The old score stays until an acceptance; only instances created afterwards get the
// new one (instances read `templates.score` when they are made).
//
// Who may call what (the domain checks it, live against current people):
// - bid: an active taker, a number other than the score, the offer and his own open bid;
// - counter: any active giver; at exactly the lowest live bid it accepts that bid;
// - acceptLowestBid: any active giver, with the lowest bid he saw;
// - acceptOffer: any active taker, with the offer he saw.
//
// Each action has an `…In(tx)` twin for callers that already hold a transaction (the demo seed).
//
// A proposed template (#209, switch `choreBidding`): the same four actions, plus a taker's Nechci
// and a giver's turn-down, run the first-score bidding of `src/domain/templateBidding.ts` instead.
// Its offer is `templates.score`; a counter or a turn-down starts a new offer round (approvals
// count per round) with a giver row in the thread; any agreement makes it active (`agreeIn`).
// With the switch off a proposed template answers `not_agreed`, as before the switch existed.

// The switch the caller read (#209). Off by default: the demo seed and older callers.
export type { BiddingOpts }
const OFF: BiddingOpts = { choreBidding: false, bidRefusals: false }

type Action = (
  tx: Tx,
  userId: number,
  templateId: number,
  score: number,
  now: Date,
  opts?: BiddingOpts,
) => Result<TemplateRow, TemplateError>

interface Ctx {
  tx: Tx
  row: TemplateRow
  agreement: TemplateAgreement
  people: Person[]
}

type ByWhat = 'bid' | 'offer' | 'counter'

function onTemplate(
  tx: Tx,
  templateId: number,
  run: (ctx: Ctx) => Result<TemplateRow, TemplateError>,
): Result<TemplateRow, TemplateError> {
  const row = tx.select().from(templates).where(eq(templates.id, templateId)).get()
  if (!row) return fail('not_found')
  return run({ tx, row, agreement: agreementOf(tx, row), people: listPeople(tx) })
}

const inTransaction =
  (action: Action) =>
  (
    db: Db,
    userId: number,
    templateId: number,
    score: number,
    now: Date = new Date(),
    opts: BiddingOpts = OFF,
  ) =>
    db.transaction((tx) => action(tx, userId, templateId, score, now, opts))

/** Runs `proposed` on a proposed template (switch on), `active` on an agreed one. */
function byStatus(
  tx: Tx,
  templateId: number,
  opts: BiddingOpts,
  proposed: (ctx: Ctx) => Result<TemplateRow, TemplateError>,
  active: (ctx: Ctx) => Result<TemplateRow, TemplateError>,
): Result<TemplateRow, TemplateError> {
  return onTemplate(tx, templateId, (ctx) => {
    if (ctx.row.status === 'active') return active(ctx)
    return opts.choreBidding ? proposed(ctx) : fail('not_agreed')
  })
}

/**
 * A giver offers `score` on a proposed template (a counter, or the same score again after a
 * turn-down): a new offer round with his approval, and a giver row that replaces the open offer.
 */
function newOffer(tx: Tx, row: TemplateRow, giverId: number, score: number, now: Date) {
  const saved = tx
    .update(templates)
    .set({ score, offerRound: row.offerRound + 1, updatedAt: toIsoUtc(now) })
    .where(eq(templates.id, row.id))
    .returning()
    .get()
  approveIn(tx, saved, giverId, now)
  const { entry, replaced } = addEntry(
    tx,
    { templateId: row.id, userId: giverId, side: 'giver', score },
    now,
  )
  const replacedOffer = replaced
    ? { replacedOffer: { entryId: replaced.id, score: replaced.score } }
    : {}
  return { saved, entry, replacedOffer }
}

/** A proposed template agreed at `score`; throws (rolling back) if it left proposed meanwhile. */
function agreed(
  { tx, row }: Ctx,
  score: number,
  acceptedIds: readonly number[],
  by: AgreedBy,
  userId: number,
  now: Date,
  replaced: TemplateThreadRow | null = null,
): TemplateRow {
  const actor = { kind: 'user', userId } as const
  const active = agreeIn(tx, row, score, acceptedIds, by, actor, now, replaced)
  // Unreachable: the row was read proposed in this same synchronous transaction.
  if (!active) throw new Error(`template ${String(row.id)} left proposed mid-transaction`)
  return active
}

/** Open bids of current takers at `score`: the ones an acceptance at that score takes. */
function liveBidsAt(tx: Tx, templateId: number, people: Person[], score: number): number[] {
  return openRows(tx, templateId)
    .filter((r) => r.side === 'taker' && r.score === score && isActiveAs(people, r.userId, 'taker'))
    .map((r) => r.id)
}

/**
 * The change is agreed at `score`: the template gets it, every open row closes (`accepted` for
 * `acceptedIds`), and one `template.score_changed` entry names them all.
 */
function changeScore(
  { tx, row }: Ctx,
  score: number,
  acceptedIds: readonly number[],
  by: ByWhat,
  actor: { kind: 'user'; userId: number },
  now: Date,
  replacedOffer: TemplateThreadRow | null = null,
): TemplateRow {
  const saved = tx
    .update(templates)
    .set({ score, updatedAt: toIsoUtc(now) })
    .where(and(eq(templates.id, row.id), eq(templates.status, 'active')))
    .returning()
    .all()
    .at(0)
  // Unreachable: the domain refused anything but an agreed (active) template in this same
  // synchronous transaction. Throwing rolls back every write of the action.
  if (!saved) throw new Error(`template ${String(row.id)} not active mid-transaction`)
  const { accepted, closed } = closeThread(tx, row.id, acceptedIds, now)
  // An agreement resets bids (#232): no bid of this change blocks its number in the next one.
  const floor = markBidsFrom(tx, row.id)
  writeAudit(tx, {
    actor,
    action: 'template.score_changed',
    entityType: 'template',
    entityId: row.id,
    before: {
      score: row.score,
      ...(replacedOffer && {
        replacedOffer: { entryId: replacedOffer.id, score: replacedOffer.score },
      }),
      bidsFrom: floor.before,
    },
    after: { score, entryIds: accepted, closedIds: closed, by, bidsFrom: floor.after },
    at: now,
  })
  return saved
}

/** A taker bids (or re-bids) a new score. The template's score is not touched. */
export const bidOnTemplateIn: Action = (tx, takerId, templateId, score, now, opts = OFF) => {
  const write = ({ row }: Ctx): Result<TemplateRow, TemplateError> => {
    const { entry, replaced } = addEntry(
      tx,
      { templateId, userId: takerId, side: 'taker', score },
      now,
    )
    writeAudit(tx, {
      actor: { kind: 'user', userId: takerId },
      action: 'template.bid_placed',
      entityType: 'template',
      entityId: templateId,
      before: replaced ? { entryId: replaced.id, score: replaced.score } : undefined,
      after: { entryId: entry.id, score },
      at: now,
    })
    return ok(row)
  }
  return byStatus(
    tx,
    templateId,
    opts,
    (ctx) => {
      const result = placeProposedTemplateBid(ctx.agreement, ctx.people, takerId, score)
      return result.ok ? write(ctx) : result
    },
    (ctx) => {
      const result = bidTemplateScore(ctx.agreement, ctx.people, takerId, score)
      return result.ok ? write(ctx) : result
    },
  )
}

/**
 * A giver counters with a new offer to every taker. At exactly the lowest live bid the domain
 * agrees it: the counter row is written and accepted together with those bids.
 */
export const counterOnTemplateIn: Action = (tx, giverId, templateId, score, now, opts = OFF) =>
  byStatus(
    tx,
    templateId,
    opts,
    (ctx) => {
      const result = counterProposedTemplate(ctx.agreement, ctx.people, giverId, score)
      if (!result.ok) return result
      if (result.value.status === 'agreed') {
        // At exactly an open bid: the counter row and the bids at it are accepted.
        const bids = liveBidsAt(tx, templateId, ctx.people, score)
        const counter = { templateId, userId: giverId, side: 'giver', score } as const
        const { entry, replaced } = addEntry(tx, counter, now)
        return ok(agreed(ctx, score, [...bids, entry.id], 'counter', giverId, now, replaced))
      }
      const { saved, entry, replacedOffer } = newOffer(tx, ctx.row, giverId, score, now)
      writeAudit(tx, {
        actor: { kind: 'user', userId: giverId },
        action: 'template.score_countered',
        entityType: 'template',
        entityId: templateId,
        before: { score: ctx.row.score, offerRound: ctx.row.offerRound, ...replacedOffer },
        after: { score, offerRound: saved.offerRound, entryId: entry.id },
        at: now,
      })
      return ok(saved)
    },
    (ctx) => counterActive(ctx, giverId, templateId, score, now),
  )

function counterActive(
  ctx: Ctx,
  giverId: number,
  templateId: number,
  score: number,
  now: Date,
): Result<TemplateRow, TemplateError> {
  const { tx } = ctx
  const result = counterTemplateScore(ctx.agreement, ctx.people, giverId, score)
  if (!result.ok) return result
  const actor = { kind: 'user', userId: giverId } as const
  const bids = liveBidsAt(tx, templateId, ctx.people, score)
  const { entry, replaced } = addEntry(
    tx,
    { templateId, userId: giverId, side: 'giver', score },
    now,
  )
  if (result.value.status === 'agreed' && result.value.change === null) {
    return ok(changeScore(ctx, score, [...bids, entry.id], 'counter', actor, now, replaced))
  }
  writeAudit(tx, {
    actor,
    action: 'template.score_countered',
    entityType: 'template',
    entityId: templateId,
    before: replaced ? { entryId: replaced.id, score: replaced.score } : undefined,
    after: { entryId: entry.id, score },
    at: now,
  })
  return ok(ctx.row)
}

/** A giver accepts the lowest bid (`score` = the lowest he saw); every bid at it is accepted. */
export const acceptLowestBidOnTemplateIn: Action = (
  tx,
  giverId,
  templateId,
  score,
  now,
  opts = OFF,
) =>
  byStatus(
    tx,
    templateId,
    opts,
    (ctx) => {
      const result = acceptLowestProposedTemplateBid(ctx.agreement, ctx.people, giverId, score)
      if (!result.ok) return result
      const bids = liveBidsAt(tx, templateId, ctx.people, score)
      return ok(agreed(ctx, score, bids, 'bid', giverId, now))
    },
    (ctx) => {
      const result = acceptLowestTemplateBid(ctx.agreement, ctx.people, giverId, score)
      if (!result.ok) return result
      const bids = liveBidsAt(tx, templateId, ctx.people, score)
      return ok(changeScore(ctx, score, bids, 'bid', { kind: 'user', userId: giverId }, now))
    },
  )

/** A taker accepts the giver side's offer (`score` = the offer he saw). */
export const acceptOfferOnTemplateIn: Action = (tx, takerId, templateId, score, now, opts = OFF) =>
  byStatus(
    tx,
    templateId,
    opts,
    (ctx) => {
      // A taker who bid says yes to the offer: the offer row (if any) is accepted.
      const result = acceptProposedTemplateOffer(ctx.agreement, ctx.people, takerId, score)
      if (!result.ok) return result
      return ok(agreed(ctx, score, offerRowIds(tx, templateId), 'offer', takerId, now))
    },
    (ctx) => acceptOfferActive(ctx, takerId, templateId, score, now),
  )

function acceptOfferActive(
  ctx: Ctx,
  takerId: number,
  templateId: number,
  score: number,
  now: Date,
): Result<TemplateRow, TemplateError> {
  const { tx } = ctx
  const result = acceptTemplateOffer(ctx.agreement, ctx.people, takerId, score)
  if (!result.ok) return result
  const offer = openRows(tx, templateId).filter((r) => r.side === 'giver')
  return ok(
    changeScore(
      ctx,
      score,
      offer.map((r) => r.id),
      'offer',
      { kind: 'user', userId: takerId },
      now,
    ),
  )
}

// ── A taker's Nechci, a giver's turn-down ──────────────────────────────────────────────────
// On a proposed template (#209, switch `choreBidding`) and on an agreed one's score change
// (#232, switch `bidRefusals`; off → `not_proposed`, as before the switch existed).

/** Runs `proposed` on a proposed template, `active` on an agreed one when `bidRefusals` is on. */
function byRefusal(
  tx: Tx,
  templateId: number,
  opts: BiddingOpts,
  proposed: (ctx: Ctx) => Result<TemplateRow, TemplateError>,
  active: (ctx: Ctx) => Result<TemplateRow, TemplateError>,
): Result<TemplateRow, TemplateError> {
  return byStatus(tx, templateId, opts, proposed, (ctx) =>
    opts.bidRefusals ? active(ctx) : fail('not_proposed'),
  )
}

/** Closes the taker's open bid and writes `template.bid_withdrawn`. */
function closeBid(tx: Tx, takerId: number, templateId: number, now: Date) {
  const bid = openRows(tx, templateId).find((r) => r.side === 'taker' && r.userId === takerId)
  // Unreachable: the domain found his open bid in this same transaction.
  if (!bid) throw new Error('a withdrawn bid is open')
  closeRows(tx, [bid.id], now)
  writeAudit(tx, {
    actor: { kind: 'user', userId: takerId },
    action: 'template.bid_withdrawn',
    entityType: 'template',
    entityId: templateId,
    before: { entryId: bid.id, score: bid.score },
    at: now,
  })
}

/** A taker says no (Nechci): his open bid closes, other bids stay. */
export function withdrawTemplateBidIn(
  tx: Tx,
  takerId: number,
  templateId: number,
  now: Date,
  opts: BiddingOpts = OFF,
): Result<TemplateRow, TemplateError> {
  return byRefusal(
    tx,
    templateId,
    opts,
    (ctx) => {
      const result = withdrawProposedTemplateBid(ctx.agreement, ctx.people, takerId)
      if (!result.ok) return result
      closeBid(tx, takerId, templateId, now)
      return ok(ctx.row)
    },
    (ctx) => {
      const result = withdrawTemplateChangeBid(ctx.agreement, ctx.people, takerId)
      if (!result.ok) return result
      closeBid(tx, takerId, templateId, now)
      return ok(ctx.row)
    },
  )
}

/**
 * A giver turns the bidding down: every open bid closes. On a proposed template he offers the
 * current score again in a new offer round; on a score change the giver offer (if any) is offered
 * again by him, and with none the change ends. Bids reset (#232). `seen` are the bids he saw; if
 * they changed meanwhile, `offer_changed`.
 */
export function turnDownTemplateBidsIn(
  tx: Tx,
  giverId: number,
  templateId: number,
  seen: readonly { takerId: number; score: number }[],
  now: Date,
  opts: BiddingOpts = OFF,
): Result<TemplateRow, TemplateError> {
  const book = seen.map((b) => ({ by: b.takerId, score: b.score }))
  const closeBids = () => {
    const bids = openRows(tx, templateId).filter((r) => r.side === 'taker')
    closeRows(
      tx,
      bids.map((b) => b.id),
      now,
    )
    return bids.map((b) => b.id)
  }
  return byRefusal(
    tx,
    templateId,
    opts,
    (ctx) => {
      const result = turnDownProposedTemplateBids(ctx.agreement, ctx.people, giverId, book)
      if (!result.ok) return result
      const entryIds = closeBids()
      const { saved, entry, replacedOffer } = newOffer(tx, ctx.row, giverId, ctx.row.score, now)
      const floor = markBidsFrom(tx, templateId)
      writeAudit(tx, {
        actor: { kind: 'user', userId: giverId },
        action: 'template.bids_turned_down',
        entityType: 'template',
        entityId: templateId,
        before: {
          score: ctx.row.score,
          offerRound: ctx.row.offerRound,
          entryIds,
          ...replacedOffer,
          bidsFrom: floor.before,
        },
        after: {
          score: saved.score,
          offerRound: saved.offerRound,
          entryId: entry.id,
          bidsFrom: floor.after,
        },
        at: now,
      })
      return ok(saved)
    },
    (ctx) => {
      const result = turnDownTemplateChangeBids(ctx.agreement, ctx.people, giverId, book)
      if (!result.ok) return result
      const entryIds = closeBids()
      // The offer stays in flight, now his (a new giver row); with none the change ends.
      const offer = result.value.status === 'agreed' ? result.value.change?.offer : null
      const reissued = offer
        ? addEntry(tx, { templateId, userId: giverId, side: 'giver', score: offer.score }, now)
        : null
      const floor = markBidsFrom(tx, templateId)
      const replaced = reissued?.replaced
      writeAudit(tx, {
        actor: { kind: 'user', userId: giverId },
        action: 'template.bids_turned_down',
        entityType: 'template',
        entityId: templateId,
        before: {
          score: ctx.row.score,
          entryIds,
          ...(replaced && { replacedOffer: { entryId: replaced.id, score: replaced.score } }),
          bidsFrom: floor.before,
        },
        after: {
          ...(reissued && { entryId: reissued.entry.id }),
          bidsFrom: floor.after,
        },
        at: now,
      })
      return ok(ctx.row)
    },
  )
}

export const withdrawTemplateBid = (
  db: Db,
  takerId: number,
  templateId: number,
  now: Date = new Date(),
  opts: BiddingOpts = OFF,
) => db.transaction((tx) => withdrawTemplateBidIn(tx, takerId, templateId, now, opts))

export const turnDownTemplateBids = (
  db: Db,
  giverId: number,
  templateId: number,
  seen: readonly { takerId: number; score: number }[],
  now: Date = new Date(),
  opts: BiddingOpts = OFF,
) => db.transaction((tx) => turnDownTemplateBidsIn(tx, giverId, templateId, seen, now, opts))

export const bidOnTemplate = inTransaction(bidOnTemplateIn)
export const counterOnTemplate = inTransaction(counterOnTemplateIn)
export const acceptLowestBidOnTemplate = inTransaction(acceptLowestBidOnTemplateIn)
export const acceptOfferOnTemplate = inTransaction(acceptOfferOnTemplateIn)
