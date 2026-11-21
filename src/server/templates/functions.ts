import { createServerFn } from '@tanstack/react-start'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import { parseApproval, parseNewTemplate, parseTemplateId } from './parse'
import {
  acceptLowestBidOnTemplate,
  acceptOfferOnTemplate,
  bidOnTemplate,
  counterOnTemplate,
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
  { ok: true; id: number; score: number } | { ok: false; error: TemplateError }

/** A giver proposes a new recurring template (spec §5.1). */
export const createTemplateFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseNewTemplate)
  .handler(({ data, context }): TemplateActionResult => {
    const result = createTemplate(getDb(), context.user.id, data)
    return result.ok ? { ok: true, id: result.value.id, score: result.value.score } : result
  })

/** A giver or taker approves the template score they were shown (spec §3). */
export const approveTemplateScoreFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseApproval)
  .handler(({ data, context }): TemplateActionResult => {
    const result = approveTemplateScore(getDb(), context.user.id, data.templateId, data.score)
    return result.ok ? { ok: true, id: result.value.id, score: result.value.score } : result
  })

/** Templates for the Úkoly screen: every one for a giver, agreed ones for a taker. */
export const listTemplatesFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }): TemplateView[] => listTemplates(getDb(), context.user.id))

// ── Score change of an agreed template (spec §5.1) ──────────────────────────────────────
// `score` is always the number the person saw: a bid or counter to put, or the lowest bid / the
// offer to accept. A number that moved meanwhile is refused (`offer_changed`).

/** A taker bids a new score for an agreed template. */
export const bidTemplateScoreFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('taker')])
  .validator(parseApproval)
  .handler(({ data, context }): TemplateActionResult => {
    const result = bidOnTemplate(getDb(), context.user.id, data.templateId, data.score)
    return result.ok ? { ok: true, id: result.value.id, score: result.value.score } : result
  })

/** A giver counters with a new offer to every taker (at the lowest bid it accepts it). */
export const counterTemplateScoreFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseApproval)
  .handler(({ data, context }): TemplateActionResult => {
    const result = counterOnTemplate(getDb(), context.user.id, data.templateId, data.score)
    return result.ok ? { ok: true, id: result.value.id, score: result.value.score } : result
  })

/** A giver accepts the lowest bid he saw. */
export const acceptTemplateBidFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseApproval)
  .handler(({ data, context }): TemplateActionResult => {
    const result = acceptLowestBidOnTemplate(getDb(), context.user.id, data.templateId, data.score)
    return result.ok ? { ok: true, id: result.value.id, score: result.value.score } : result
  })

/** A taker accepts the giver side's offer he saw. */
export const acceptTemplateOfferFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('taker')])
  .validator(parseApproval)
  .handler(({ data, context }): TemplateActionResult => {
    const result = acceptOfferOnTemplate(getDb(), context.user.id, data.templateId, data.score)
    return result.ok ? { ok: true, id: result.value.id, score: result.value.score } : result
  })

/** A template's price page: the template and every offer and bid, or null (not found). */
export const getTemplateDetailFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseTemplateId)
  .handler(({ data, context }): TemplateDetail | null =>
    getTemplateDetail(getDb(), data.templateId, context.user.id),
  )

/** "Čeká na tebe": agreed templates whose score change waits for this person's side. */
export const listPendingTemplatePriceChangesFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }): TemplateView[] => pendingTemplatePriceChanges(getDb(), context.user.id))

/** "Čeká na tebe": proposed templates waiting for this person's approval. */
export const listPendingTemplateApprovalsFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }): TemplateView[] => pendingTemplateApprovals(getDb(), context.user.id))
