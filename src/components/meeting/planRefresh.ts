import type { PlanAnswer } from '~/server/instances/functions'
import { planShown } from './meetingFlow'
import type { MeetingStep } from './meetingFlow'

// The meeting's plan table refresh (#259, "Obnovit"), framework-free so every case is tested.
// The loader gives a plan; Obnovit fetches a newer one on top of it. A refreshed plan only shows
// while the loader plan it was fetched from (`base`) is still the current one: a route reload
// gives a new object, and the newer loader data wins over an older refresh answer.
// Nothing refreshes by itself (Jakub, wireframe; spec §5.12).

export interface RefreshState {
  /** The loader plan the last refresh started from. Compared by identity. */
  base: PlanAnswer | null
  /** The refreshed plan for `base`, or null before its first answer. */
  plan: PlanAnswer | null
  busy: boolean
  failed: boolean
}

export const REFRESH_START: RefreshState = { base: null, plan: null, busy: false, failed: false }

export type RefreshEvent =
  | { type: 'sending'; base: PlanAnswer }
  | { type: 'answer'; base: PlanAnswer; plan: PlanAnswer }
  | { type: 'failed'; base: PlanAnswer }

export function refreshReduce(s: RefreshState, e: RefreshEvent): RefreshState {
  switch (e.type) {
    case 'sending':
      return { base: e.base, plan: e.base === s.base ? s.plan : null, busy: true, failed: false }
    case 'answer':
      return e.base === s.base ? { ...s, plan: e.plan, busy: false } : { ...s, busy: false }
    case 'failed':
      return e.base === s.base ? { ...s, busy: false, failed: true } : { ...s, busy: false }
  }
}

export interface RefreshView {
  plan: PlanAnswer
  busy: boolean
  failed: boolean
}

/** What to draw: the refreshed plan only while it was fetched on top of the current loader plan. */
export function refreshView(s: RefreshState, loaded: PlanAnswer): RefreshView {
  if (s.base !== loaded) return { plan: loaded, busy: s.busy, failed: false }
  return { plan: s.plan ?? loaded, busy: s.busy, failed: s.failed }
}

/** One call at a time (as createConfirm); the in-flight flag is cleared in `finally`. */
export function createRefresh(
  fetch: () => Promise<PlanAnswer>,
  dispatch: (e: RefreshEvent) => void,
): (base: PlanAnswer) => Promise<void> {
  let inFlight = false
  return async (base) => {
    if (inFlight) return
    inFlight = true
    dispatch({ type: 'sending', base })
    try {
      const plan = await fetch()
      dispatch({ type: 'answer', base, plan })
    } catch {
      dispatch({ type: 'failed', base })
    } finally {
      inFlight = false
    }
  }
}

/** The Obnovit tap: always sends the loader plan as `base`, never the plan on screen. */
export function refreshTap(
  refresh: (base: PlanAnswer) => Promise<void>,
  loaded: PlanAnswer,
): () => Promise<void> {
  return () => refresh(loaded)
}

/** Step 3's plan block: what to draw, and whether it shows (and the screen is wide). */
export function meetingPlanView(
  step: MeetingStep,
  settledToday: boolean,
  state: RefreshState,
  loaded: PlanAnswer | null,
): { view: RefreshView | null; shown: boolean } {
  if (loaded === null) return { view: null, shown: false }
  const view = refreshView(state, loaded)
  return { view, shown: planShown(step, settledToday, view.plan) }
}
