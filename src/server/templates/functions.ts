import { createServerFn } from '@tanstack/react-start'
import { ForbiddenError, requireRole } from '~/server/auth/guards'
import type { Role } from '~/domain'
import type { Result } from '~/domain/result'
import type { Db } from '~/server/db'
import { getDb } from '~/server/db'
import type { TemplateRow, TemplateStatus } from '~/server/db/schema'
import { STALE, seenOf, unseen } from '~/server/descriptions/seen'
import { getFlags } from '~/server/features'
import { hasDescription } from '~/server/descriptions/parse'
import {
  parseNewTemplate,
  parseSeenApproval,
  parseSeenScore,
  parseTemplateId,
  parseTemplateTurnDown,
} from './parse'
import {
  acceptLowestBidOnTemplate,
  acceptOfferOnTemplate,
  bidOnTemplate,
  counterOnTemplate,
  turnDownTemplateBids,
  withdrawTemplateBid,
} from './scoreChange'
import type {
  BiddingOpts,
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

/**
 * The switches the reads and score actions take: `choreBidding` (#209), `bidRefusals` (#232) and
 * `descriptions` (#207).
 */
const bidding = (db: Db): BiddingOpts => {
  const { choreBidding, bidRefusals, descriptions } = getFlags(db)
  return { choreBidding, bidRefusals, descriptions }
}

const OFF = { ok: false, error: 'feature_off' } as const

/** A giver proposes a new recurring template (spec §5.1); a description needs the switch. */
export function createTemplateHandler(
  db: Db,
  userId: number,
  data: NewTemplate,
  now: Date,
): TemplateActionResult | typeof OFF {
  if (!getFlags(db).descriptions && hasDescription(data.description ?? undefined)) return OFF
  return answered(createTemplate(db, userId, data, now))
}

/** A giver or taker approves the template score they were shown (spec §3). */
export function approveTemplateScoreHandler(db: Db, userId: number, data: Seen, now: Date) {
  if (unseen(db, data)) return STALE
  return answered(
    approveTemplateScore(db, userId, data.templateId, data.score, now, seenOf(db, data)),
  )
}

export const createTemplateFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseNewTemplate)
  .handler(({ data, context }) => createTemplateHandler(getDb(), context.user.id, data, new Date()))

export const approveTemplateScoreFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseSeenScore)
  .handler(({ data, context }) =>
    approveTemplateScoreHandler(getDb(), context.user.id, data, new Date()),
  )

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

/**
 * The number, and the chore status the page showed (#243): a bid, counter or accept sent while
 * proposed that lands on an active chore (or the other way) is `offer_changed`.
 */
interface Score {
  templateId: number
  score: number
  seenStatus?: TemplateStatus
}

/** A taker's number, with the text his page showed (#207 ruling 8). */
type Seen = Score & { seenDescription?: string | null }

/** A taker bids a score. */
export function bidTemplateScoreHandler(db: Db, userId: number, data: Seen, now: Date) {
  if (unseen(db, data)) return STALE
  const opts = { ...bidding(db), seenDescription: seenOf(db, data), seenStatus: data.seenStatus }
  return answered(bidOnTemplate(db, userId, data.templateId, data.score, now, opts))
}

/** A giver counters with a new offer to every taker (at an open bid it agrees at it). */
export function counterTemplateScoreHandler(db: Db, userId: number, data: Score, now: Date) {
  const opts = { ...bidding(db), seenStatus: data.seenStatus }
  return answered(counterOnTemplate(db, userId, data.templateId, data.score, now, opts))
}

/** A giver accepts the lowest bid he saw. */
export function acceptTemplateBidHandler(db: Db, userId: number, data: Score, now: Date) {
  const opts = { ...bidding(db), seenStatus: data.seenStatus }
  return answered(acceptLowestBidOnTemplate(db, userId, data.templateId, data.score, now, opts))
}

/** A taker accepts the giver side's offer he saw. */
export function acceptTemplateOfferHandler(db: Db, userId: number, data: Seen, now: Date) {
  if (unseen(db, data)) return STALE
  const opts = { ...bidding(db), seenDescription: seenOf(db, data), seenStatus: data.seenStatus }
  return answered(acceptOfferOnTemplate(db, userId, data.templateId, data.score, now, opts))
}

/** A taker's Nechci: his open bid closes (a proposed chore, or a price change with `bidRefusals`). */
export function withdrawTemplateBidHandler(
  db: Db,
  userId: number,
  data: { templateId: number },
  now: Date,
) {
  return answered(withdrawTemplateBid(db, userId, data.templateId, now, bidding(db)))
}

/**
 * A giver turns the bids he saw down (a proposed chore, or a price change with `bidRefusals`):
 * they close and the offer stands; a price change with no offer ends.
 */
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
  .validator(parseSeenScore)
  .handler(({ data, context }) =>
    bidTemplateScoreHandler(getDb(), context.user.id, data, new Date()),
  )

export const counterTemplateScoreFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseSeenApproval)
  .handler(({ data, context }) =>
    counterTemplateScoreHandler(getDb(), context.user.id, data, new Date()),
  )

export const acceptTemplateBidFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseSeenApproval)
  .handler(({ data, context }) =>
    acceptTemplateBidHandler(getDb(), context.user.id, data, new Date()),
  )

export const acceptTemplateOfferFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('taker')])
  .validator(parseSeenScore)
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

/**
 * A template's price page: the template and every offer and bid, or null (not found). The admin
 * reads it only while `disputes` is on (#222); every write stays giver or taker.
 */
export function templateDetailHandler(
  db: Db,
  viewer: { id: number; role: Role },
  data: { templateId: number },
): TemplateDetail | null {
  const flags = getFlags(db)
  if (viewer.role === 'admin' && !flags.disputes) throw new ForbiddenError()
  return getTemplateDetail(db, data.templateId, viewer.id, bidding(db), flags.openRows)
}

export const getTemplateDetailFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker', 'admin')])
  .validator(parseTemplateId)
  .handler(({ data, context }) => templateDetailHandler(getDb(), context.user, data))

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
