import { adminDisputeErrorMessage, disputeErrorMessage } from '~/lib/disputeErrors'
import { cs } from '~/lib/strings'
import type {
  DismissDisputeInput,
  DismissDisputeResult,
  OpenDisputeInput,
  OpenDisputeResult,
} from '~/server/disputes/functions'

// The one place the dispute drawer (#46) and the admin's keep dialog (#47) reach the server.

export type OpenDisputeCall = (args: { data: OpenDisputeInput }) => Promise<OpenDisputeResult>

/** Sends the dispute; null when it went through, else the Czech message to show. */
export async function sendDispute(
  call: OpenDisputeCall,
  input: OpenDisputeInput,
): Promise<string | null> {
  try {
    const r = await call({ data: input })
    return r.ok ? null : disputeErrorMessage(r.error)
  } catch {
    return cs.disputes.errors.generic
  }
}

export type DismissDisputeCall = (args: {
  data: DismissDisputeInput
}) => Promise<DismissDisputeResult>

/** What an admin dialog (Ponechat, Opravit) does next: done, or a Czech message and whether the list is stale. */
export type AdminOutcome = { ok: true } | { ok: false; message: string; reload: boolean }

/** The row no longer matches the server (changed, closed, gone): close and reload the list. */
export const STALE: readonly string[] = ['value_changed', 'not_open', 'not_found']

/** Sends the admin's dismissal with the value the row showed. */
export async function sendDismiss(
  call: DismissDisputeCall,
  input: DismissDisputeInput,
): Promise<AdminOutcome> {
  try {
    const r = await call({ data: input })
    if (r.ok) return { ok: true }
    return {
      ok: false,
      message: adminDisputeErrorMessage(r.error),
      reload: STALE.includes(r.error),
    }
  } catch {
    return { ok: false, message: cs.disputes.errors.generic, reload: false }
  }
}
