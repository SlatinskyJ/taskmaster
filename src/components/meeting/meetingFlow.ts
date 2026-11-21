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
  asking: false,
  busy: false,
  result: null,
  names: [],
}

export function stepOf(meeting: Meeting, ui: MeetingUi): MeetingStep {
  if (ui.result || !meeting.period) return 3
  if (meeting.pending.length > 0 || !ui.advanced) return 1
  return 2
}

export type MeetingEvent =
  | { type: 'next' }
  | { type: 'ask' }
  | { type: 'back' }
  | { type: 'sending' }
  | { type: 'answer'; result: SettleResult; names: readonly { id: number; name: string }[] }
  | { type: 'failed' }

export function reduce(ui: MeetingUi, event: MeetingEvent): MeetingUi {
  switch (event.type) {
    case 'next':
      return { ...ui, advanced: true }
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
    if (inFlight || !request) return
    inFlight = true
    dispatch({ type: 'sending' })
    try {
      const result = await send(request)
      const names = meeting.period ? meeting.takers.map((t) => ({ id: t.id, name: t.name })) : []
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
