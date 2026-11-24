import { disputeErrorMessage } from '~/lib/disputeErrors'
import { cs } from '~/lib/strings'
import type { OpenDisputeInput, OpenDisputeResult } from '~/server/disputes/functions'

// The one place the dispute drawer reaches the server (#46).

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
