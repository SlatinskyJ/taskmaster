import { createServerFn } from '@tanstack/react-start'
import { requireRole } from '~/server/auth/guards'
import type { Result } from '~/domain/result'
import type { Db } from '~/server/db'
import { getDb } from '~/server/db'
import type { TemplateRow, TemplateStatus } from '~/server/db/schema'
import { getFlags } from '~/server/features'
import { parseApproval, parseNewTemplate, parseTemplateId, parseTemplateTurnDown } from './parse'
import {
  acceptLowestBidOnTemplate,
  acceptOfferOnTemplate,
  bidOnTemplate,
  counterOnTemplate,
  turnDownTemplateBids,
  withdrawTemplateBid,
} from './scoreChange'
import type {
  NewTemplate,
  TemplateChangeView,
  TemplateDetail,
  TemplateError,
  TemplateView,
} from './templates'
import {
  approveTemplateScore,
  createTemplate,
  getTemplateDetail,
  listTemplates,
  pendingTemplateApprovals,
  pendingTemplatePriceChanges,
} from './templates'

export type { NewTemplate, TemplateChangeView, TemplateDetail, TemplateError, TemplateView }

// Server functions for recurring templates (#37). Roles are checked here (guards) and again by
// the domain rules inside (`not_a_giver`, `not_a_party`).

/** On success, `score` is the template's score after the action (moved only by an agreement). */
export type TemplateActionResult =
  | { ok: true; id: number; score: number; status: TemplateStatus }
  | { ok: false; error: TemplateError }

const answered = (result: Result<TemplateRow, TemplateError>): TemplateActionResult =>
  result.ok
    ? { ok: true, id: result.value.id, score: result.value.score, status: result.value.status }
    : result

/** The `choreBidding` switch (#209) as the score actions take it. */
const bidding = (db: Db) => ({ choreBidding: getFlags(db).choreBidding })

/** A giver proposes a new recurring template (spec §5.1). */
export const createTemplateFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseNewTemplate)
  .handler(({ data, context }): TemplateActionResult => {
    return answered(createTemplate(getDb(), context.user.id, data))
  })

/** A giver or taker approves the template score they were shown (spec §3). */
export const approveTemplateScoreFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseApproval)
  .handler(({ data, context }): TemplateActionResult => {
    return answered(approveTemplateScore(getDb(), context.user.id, data.templateId, data.score))
  })

/** Templates for the Úkoly screen: every one for a giver, agreed ones for a taker. */
export const listTemplatesFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }): TemplateView[] =>
    listTemplates(getDb(), context.user.id, bidding(getDb())),
  )

// ── Score change (spec §5.1) and first-price bidding (#209) ──────────────────────────────
// On an agreed template these change its score; on a proposed one (switch `choreBidding`, off →
// `not_agreed`) they bid on its first price. `score` is always the number the person saw: a bid or
// counter to put, or the lowest bid / the offer to accept. A number that moved meanwhile is refused
// (`offer_changed`). The handlers are plain functions, tested directly.

interface Score {
  templateId: number
  score: number
}

/** A taker bids a score. */
export function bidTemplateScoreHandler(db: Db, userId: number, data: Score, now: Date) {
  return answered(bidOnTemplate(db, userId, data.templateId, data.score, now, bidding(db)))
}

/** A giver counters with a new offer to every taker (at an open bid it agrees at it). */
export function counterTemplateScoreHandler(db: Db, userId: number, data: Score, now: Date) {
  return answered(counterOnTemplate(db, userId, data.templateId, data.score, now, bidding(db)))
}

/** A giver accepts the lowest bid he saw. */
export function acceptTemplateBidHandler(db: Db, userId: number, data: Score, now: Date) {
  const opts = bidding(db)
  return answered(acceptLowestBidOnTemplate(db, userId, data.templateId, data.score, now, opts))
}

/** A taker accepts the giver side's offer he saw. */
export function acceptTemplateOfferHandler(db: Db, userId: number, data: Score, now: Date) {
  return answered(acceptOfferOnTemplate(db, userId, data.templateId, data.score, now, bidding(db)))
}

/** A taker's Nechci on a proposed template: his open bid closes. */
export function withdrawTemplateBidHandler(
  db: Db,
  userId: number,
  data: { templateId: number },
  now: Date,
) {
  return answered(withdrawTemplateBid(db, userId, data.templateId, now, bidding(db)))
}

/** A giver turns a proposed template's bidding down: the bids he saw close, the offer stands. */
export function turnDownTemplateBidsHandler(
  db: Db,
  userId: number,
  data: { templateId: number; bids: { takerId: number; score: number }[] },
  now: Date,
) {
  return answered(turnDownTemplateBids(db, userId, data.templateId, data.bids, now, bidding(db)))
}

export const bidTemplateScoreFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('taker')])
  .validator(parseApproval)
  .handler(({ data, context }) =>
    bidTemplateScoreHandler(getDb(), context.user.id, data, new Date()),
  )

export const counterTemplateScoreFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseApproval)
  .handler(({ data, context }) =>
    counterTemplateScoreHandler(getDb(), context.user.id, data, new Date()),
  )

export const acceptTemplateBidFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseApproval)
  .handler(({ data, context }) =>
    acceptTemplateBidHandler(getDb(), context.user.id, data, new Date()),
  )

export const acceptTemplateOfferFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('taker')])
  .validator(parseApproval)
  .handler(({ data, context }) =>
    acceptTemplateOfferHandler(getDb(), context.user.id, data, new Date()),
  )

export const withdrawTemplateBidFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('taker')])
  .validator(parseTemplateId)
  .handler(({ data, context }) =>
    withdrawTemplateBidHandler(getDb(), context.user.id, data, new Date()),
  )

export const turnDownTemplateBidsFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseTemplateTurnDown)
  .handler(({ data, context }) =>
    turnDownTemplateBidsHandler(getDb(), context.user.id, data, new Date()),
  )

/** A template's price page: the template and every offer and bid, or null (not found). */
export const getTemplateDetailFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseTemplateId)
  .handler(({ data, context }): TemplateDetail | null =>
    getTemplateDetail(getDb(), data.templateId, context.user.id, bidding(getDb())),
  )

/** "Čeká na tebe": agreed templates whose score change waits for this person's side. */
export const listPendingTemplatePriceChangesFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }): TemplateView[] =>
    pendingTemplatePriceChanges(getDb(), context.user.id, bidding(getDb())),
  )

/** "Čeká na tebe": proposed templates waiting for this person's approval. */
export const listPendingTemplateApprovalsFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }): TemplateView[] =>
    pendingTemplateApprovals(getDb(), context.user.id, bidding(getDb())),
  )
