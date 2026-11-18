import { createServerFn } from '@tanstack/react-start'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import { parseApproval, parseNewTemplate } from './parse'
import type { NewTemplate, TemplateError, TemplateView } from './templates'
import {
  approveTemplateScore,
  createTemplate,
  listTemplates,
  pendingTemplateApprovals,
} from './templates'

export type { NewTemplate, TemplateError, TemplateView }

// Server functions for recurring templates (#37). Roles are checked here (guards) and again by
// the domain rules inside (`not_a_giver`, `not_a_party`).

export type TemplateActionResult = { ok: true; id: number } | { ok: false; error: TemplateError }

/** A giver proposes a new recurring template (spec §5.1). */
export const createTemplateFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver')])
  .validator(parseNewTemplate)
  .handler(({ data, context }): TemplateActionResult => {
    const result = createTemplate(getDb(), context.user.id, data)
    return result.ok ? { ok: true, id: result.value.id } : result
  })

/** A giver or taker approves the template score they were shown (spec §3). */
export const approveTemplateScoreFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('giver', 'taker')])
  .validator(parseApproval)
  .handler(({ data, context }): TemplateActionResult => {
    const result = approveTemplateScore(getDb(), context.user.id, data.templateId, data.score)
    return result.ok ? { ok: true, id: result.value.id } : result
  })

/** Every template, for the giver's Úkoly screen. */
export const listTemplatesFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver')])
  .handler((): TemplateView[] => listTemplates(getDb()))

/** "Čeká na tebe": proposed templates waiting for this person's approval. */
export const listPendingTemplateApprovalsFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('giver', 'taker')])
  .handler(({ context }): TemplateView[] => pendingTemplateApprovals(getDb(), context.user.id))
