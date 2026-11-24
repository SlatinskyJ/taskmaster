import { STALE } from '~/components/disputes/disputeCalls'
import type { AdminOutcome } from '~/components/disputes/disputeCalls'
import { fixErrorMessage } from '~/lib/fixErrors'
import { cs } from '~/lib/strings'
import type {
  AdjustPointsInput,
  CorrectSettlementInput,
  FixResult,
} from '~/server/corrections/functions'

// The one place the fix sheet (#48) reaches the server. A stale Sporné row (STALE, shared with
// Ponechat) closes the sheet and reloads the list.

export type AdjustCall = (args: { data: AdjustPointsInput }) => Promise<FixResult>
export type CorrectCall = (args: { data: CorrectSettlementInput }) => Promise<FixResult>

export type FixRequest =
  { mode: 'week'; input: CorrectSettlementInput } | { mode: 'points'; input: AdjustPointsInput }

export async function sendFix(
  calls: { adjust: AdjustCall; correct: CorrectCall },
  req: FixRequest,
): Promise<AdminOutcome> {
  try {
    const r =
      req.mode === 'points'
        ? await calls.adjust({ data: req.input })
        : await calls.correct({ data: req.input })
    if (r.ok) return { ok: true }
    return { ok: false, message: fixErrorMessage(r.error), reload: STALE.includes(r.error) }
  } catch {
    return { ok: false, message: cs.disputes.errors.generic, reload: false }
  }
}
