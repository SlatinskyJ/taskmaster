import { createServerFn } from '@tanstack/react-start'
import type { PeriodDefaults } from '~/domain'
import type { Result } from '~/domain/result'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import { getPeriodDefaults, plainDefaults, savePeriodDefaults } from './defaults'
import type { SetDefaultsError } from './defaults'

import { parseDefaults } from './validators'

export type { SetDefaultsError }
export { int, parseDefaults, record } from './validators'
// Proposals (#43): screens import only `<module>/functions`, so their server functions and
// view types are re-exported here.
export {
  approveProposalFn,
  getProposalsFn,
  proposeDefaultsFn,
  proposePeriodFn,
  rejectProposalFn,
  withdrawProposalFn,
} from './proposalFunctions'
export type { ProposalResult } from './proposalFunctions'
export type { Party, ProposalKind, ProposalView, ProposalsView, SpanView } from './proposals'

// Server functions for the default week on Správa (#47). Admin only: the guard here, and the
// domain's `setDefaults` again inside (`not_admin`). The admin is always the signed-in user.

/** What the screen gets: the defaults' fields, nothing else from the row. */
export const defaultsView = plainDefaults

export type SaveDefaultsResult = { ok: true } | { ok: false; error: SetDefaultsError }

export function saveResult(r: Result<PeriodDefaults, SetDefaultsError>): SaveDefaultsResult {
  return r.ok ? { ok: true } : { ok: false, error: r.error }
}

export const getPeriodDefaultsFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('admin')])
  .handler((): PeriodDefaults => defaultsView(getPeriodDefaults(getDb())))

export const savePeriodDefaultsFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin')])
  .validator(parseDefaults)
  .handler(({ data, context }) =>
    saveResult(savePeriodDefaults(getDb(), context.user.id, data, new Date())),
  )
