import { settleErrorMessage } from '~/lib/settleErrors'
import { cs } from '~/lib/strings'
import type { Meeting, SettleResult } from '~/server/settlement/functions'

// The meeting screen's state (#44, spec §5.9), framework-free so every step change is tested.
// The step comes from the server data plus this small state: step 1 while pending items exist
// (or until the giver taps "Dál: vyúčtovat"), step 2 to settle, step 3 after a confirm (from its
// response, kept here) or when there is nothing to settle. Step 2 always renders the latest
// loader data, never a copy, so a reload after `totals_changed` shows the new totals.

export type SettledOk = Extract<SettleResult, { ok: true }>
export type MeetingStep = 1 | 2 | 3

export interface MeetingUi {
  /** The giver left step 1 with "Dál: vyúčtovat". */
  advanced: boolean
  /**
   * The week he left step 1 for. A reload that shows another week (it was settled elsewhere,
   * or a confirm's answer was lost) starts at step 1 again, so the screen never leads into
   * settling the brand-new week (ruling 2).
   */
  periodId: number | null
  /** The second tap: "Vyúčtovat týden?" is showing. */
  asking: boolean
  /** A confirm is on its way to the server. */
  busy: boolean
  /** The confirm's response; once set, the screen stays on step 3 (ruling 2). */
  result: SettledOk | null
  /** The takers' names when the giver confirmed; the reloaded meeting may have none (ruling 3). */
  names: readonly { id: number; name: string }[]
}

export const START: MeetingUi = {
  advanced: false,
  periodId: null,
  asking: false,
  busy: false,
  result: null,
  names: [],
}

export function stepOf(meeting: Meeting, ui: MeetingUi): MeetingStep {
  if (ui.result || !meeting.period) return 3
  if (meeting.pending.length > 0 || !ui.advanced || ui.periodId !== meeting.period.id) return 1
  return 2
}

export type MeetingEvent =
  | { type: 'next'; periodId: number }
  | { type: 'ask' }
  | { type: 'back' }
  | { type: 'sending' }
  | { type: 'answer'; result: SettleResult; names: readonly { id: number; name: string }[] }
  | { type: 'failed' }

export function reduce(ui: MeetingUi, event: MeetingEvent): MeetingUi {
  switch (event.type) {
    case 'next':
      return { ...ui, advanced: true, periodId: event.periodId }
    case 'ask':
      return { ...ui, asking: true }
    case 'back':
      return { ...ui, asking: false }
    case 'sending':
      return { ...ui, busy: true }
    case 'failed':
      return { ...ui, busy: false, asking: false }
    case 'answer': {
      const { result } = event
      if (result.ok) return { ...ui, busy: false, asking: false, result, names: event.names }
      // Something new to approve: back to step 1. Anything else stays where it is and reloads.
      const advanced = result.error === 'pending_items' ? false : ui.advanced
      return { ...ui, busy: false, asking: false, advanced }
    }
  }
}

/** What a confirm sends: exactly the totals step 2 shows (the server refuses stale ones). */
export function settleRequest(
  meeting: Meeting,
): { data: { periodId: number; shown: { takerId: number; total: number }[] } } | null {
  if (!meeting.period) return null
  return {
    data: {
      periodId: meeting.period.id,
      shown: meeting.takers.map((t) => ({ takerId: t.id, total: t.total })),
    },
  }
}

/**
 * The confirm tap, at most one call at a time: a second tap while the first is on its way does
 * nothing (Review Focus 4), even before React re-renders the disabled button.
 */
export function createConfirm(
  send: (request: NonNullable<ReturnType<typeof settleRequest>>) => Promise<SettleResult>,
  dispatch: (event: MeetingEvent) => void,
  /** Toast and reload; null when the call itself failed (offline, server error). */
  after: (result: SettleResult | null) => Promise<void> | void,
): (meeting: Meeting) => Promise<void> {
  let inFlight = false
  return async (meeting) => {
    const request = settleRequest(meeting)
    if (inFlight || !request || !meeting.period) return
    const names = meeting.takers.map((t) => ({ id: t.id, name: t.name }))
    inFlight = true
    dispatch({ type: 'sending' })
    try {
      const result = await send(request)
      dispatch({ type: 'answer', result, names })
      await after(result)
    } catch {
      dispatch({ type: 'failed' })
      await after(null)
    } finally {
      inFlight = false
    }
  }
}

/** "Začínají s": each taker's carry-over from the response, matched by id, in screen order. */
export function startingTotals(ui: MeetingUi): { id: number; name: string; carryOver: number }[] {
  if (!ui.result) return []
  const byId = new Map(ui.result.records.map((r) => [r.takerId, r.carryOver]))
  return ui.names.flatMap((t) => {
    const carryOver = byId.get(t.id)
    return carryOver === undefined ? [] : [{ id: t.id, name: t.name, carryOver }]
  })
}

/** After a confirm: the toast for its answer, then a reload (always, so step 2 is never stale). */
export async function afterConfirm(
  result: SettleResult | null,
  ui: {
    success: (text: string) => void
    error: (text: string) => void
    reload: () => Promise<void>
  },
): Promise<void> {
  if (!result) ui.error(cs.meeting.errors.generic)
  else if (result.ok) ui.success(cs.meeting.settled)
  else ui.error(settleErrorMessage(result.error))
  await ui.reload()
}
