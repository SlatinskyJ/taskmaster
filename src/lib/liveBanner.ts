import type { LiveEvent, LiveSub } from '~/server/live/functions'
import type { Features } from './features'
import { cs } from './strings'

// The live change banner's state (#299, design "The banner"): what it counts and says. The
// component (src/components/live/LiveBanner.tsx) feeds it the stream's events; a new
// subscription key (navigation, refresh) starts again from BANNER_START.

export interface BannerState {
  /** The change keys counted since the last refresh. */
  changes: ReadonlySet<number>
  /** The sentence of the first change counted (shown while it is the only one). */
  text: string | null
  /** The server sent `overflow`: more than it replays one by one. */
  overflow: boolean
  /** False after a dismiss, until a new change. */
  shown: boolean
}

export const BANNER_START: BannerState = {
  changes: new Set(),
  text: null,
  overflow: false,
  shown: false,
}

export type BannerEvent =
  | { type: 'change'; event: Pick<LiveEvent, 'change' | 'text'> }
  | { type: 'overflow' }
  | { type: 'dismiss' }

/**
 * Ties one shown toast's dismiss to the key it was shown for. Sonner 2.0.8 also calls
 * `onDismiss` from an effect after a programmatic `toast.dismiss`, so a dismiss the banner made
 * itself (key change) must not count as the person's.
 */
export function dismissGuard(
  key: string,
  currentKey: () => string,
  dismiss: () => void,
): { onDismiss(): void; close(): void; drop(): void } {
  let done = false
  const once = () => {
    if (done || currentKey() !== key) return
    done = true
    dismiss()
  }
  return {
    onDismiss: once,
    close: once,
    drop: () => {
      done = true
    },
  }
}

export function bannerReduce(s: BannerState, e: BannerEvent): BannerState {
  switch (e.type) {
    case 'change': {
      if (s.changes.has(e.event.change)) return s
      const changes = new Set(s.changes).add(e.event.change)
      return { ...s, changes, text: s.text ?? e.event.text, shown: true }
    }
    case 'overflow':
      return { ...s, overflow: true, shown: true }
    case 'dismiss':
      return { ...s, shown: false }
  }
}

/** What the toast says, or null for no toast. */
export function bannerText(s: BannerState): string | null {
  if (!s.shown) return null
  if (s.overflow) return cs.live.banner.overflow
  if (s.changes.size >= 2) return cs.live.banner.many(s.changes.size)
  return s.text
}

const isSub = (v: unknown): v is LiveSub =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as LiveSub).token === 'string' &&
  typeof (v as LiveSub).asOf === 'number'

/** The live subscriptions of the active matches, in match order, deduplicated by token. */
export function subsOf(matches: readonly { loaderData?: unknown }[]): LiveSub[] {
  const out = new Map<string, LiveSub>()
  for (const m of matches) {
    const live = (m.loaderData as { live?: unknown } | undefined)?.live
    if (!Array.isArray(live)) continue
    for (const sub of live) {
      if (isSub(sub) && !out.has(sub.token)) out.set(sub.token, sub)
    }
  }
  return [...out.values()]
}

/** Identity of a screen's subscription: the tokens joined. Empty string for none. */
export function subsKey(subs: readonly LiveSub[]): string {
  return subs.map((s) => s.token).join(' ')
}

/** #313: the banner is this screen's refresh (the switch on, the loader subscribed). */
export function offersLiveRefresh(
  features: Pick<Features, 'liveChanges'>,
  live: readonly LiveSub[],
): boolean {
  return features.liveChanges && live.length > 0
}
