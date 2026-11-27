import type { LiveEvent, LiveSub } from '~/server/live/functions'
import { createSseParser } from './liveSse'

// The tab's live stream (#299): one `fetch`-based SSE stream with its own retry. Native
// EventSource gives up for good after a non-200, and every merge restarts production (the proxy
// answers 502/503 meanwhile), so the client keeps reconnecting, with `since=<last id>`, and the
// server replays what the tab missed. Rules: src/server/live/README.md "The banner (client)".

export interface LiveHandlers {
  change(e: LiveEvent): void
  overflow(): void
}

export interface ConnectDeps {
  fetch: typeof fetch
  setTimeout: (run: () => void, ms: number) => unknown
  clearTimeout: (h: unknown) => void
  isVisible: () => boolean
  /** Calls back when the tab is visible and focused again, or back online; returns unsubscribe. */
  onInHand: (run: () => void) => () => void
  /** `frameHeader(window)`: a viewer frame's session token. */
  headers: Record<string, string>
}

/** Waits before each reconnect after a failure; the last one repeats. `: open` starts over. */
export const RETRY_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000]
/** No byte (data or ping, every 25 s) for this long: the socket is dead, reconnect. */
export const STALE_MS = 60_000

/** Statuses that never get better by retrying: switch off, signed out, refused topics. */
const STOP = new Set([400, 401, 404])

export function liveUrl(subs: readonly LiveSub[], tab: string, since: number | null): string {
  const q = new URLSearchParams()
  for (const s of subs) q.append('t', s.token)
  q.set('tab', tab)
  if (since !== null) q.set('since', String(since))
  return `/api/live?${q.toString()}`
}

function asEvent(data: string): LiveEvent | null {
  try {
    const v = JSON.parse(data) as Partial<LiveEvent> | null
    if (typeof v?.id === 'number' && typeof v.change === 'number' && typeof v.text === 'string') {
      return v as LiveEvent
    }
  } catch {
    // Not JSON.
  }
  return null
}

const idOf = (id: string | null): number | null =>
  id !== null && /^\d{1,16}$/.test(id) ? Number(id) : null

export function connectLive(
  subs: readonly LiveSub[],
  tab: string,
  on: LiveHandlers,
  deps: ConnectDeps,
): { close(): void } {
  let since: number | null = null
  let retries = 0
  let current: AbortController | null = null
  let retryTimer: unknown = null
  let staleTimer: unknown = null
  let stopInHand: (() => void) | null = null

  const clearStale = () => {
    if (staleTimer !== null) deps.clearTimeout(staleTimer)
    staleTimer = null
  }

  /** Ends the attempt in flight; its reads then see they are no longer current. */
  const abort = () => {
    clearStale()
    current?.abort()
    current = null
  }

  const whenInHand = () => {
    if (stopInHand) return
    stopInHand = deps.onInHand(() => {
      stopInHand?.()
      stopInHand = null
      void open()
    })
  }

  /** After a failure of the current attempt: the next one after the backoff, or once in hand. */
  const retry = () => {
    abort()
    if (!deps.isVisible()) {
      whenInHand()
      return
    }
    const ms = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)] ?? STALE_MS
    retries += 1
    retryTimer = deps.setTimeout(() => {
      retryTimer = null
      if (deps.isVisible()) void open()
      else whenInHand()
    }, ms)
  }

  async function open(): Promise<void> {
    const mine = new AbortController()
    current = mine
    /** Still this tab's attempt: not closed, replaced, gone stale or failed since. */
    const live = () => current === mine
    const armStale = () => {
      clearStale()
      staleTimer = deps.setTimeout(() => {
        staleTimer = null
        abort()
        void open()
      }, STALE_MS)
    }

    armStale()
    let res: Response
    try {
      res = await deps.fetch(liveUrl(subs, tab, since), {
        headers: deps.headers,
        signal: mine.signal,
        cache: 'no-store',
      })
    } catch {
      if (live()) retry()
      return
    }
    if (!live()) return
    if (res.status !== 200 || !res.body) {
      if (STOP.has(res.status)) {
        if (res.status === 400) console.error('[live] stream refused: 400')
        abort()
        return
      }
      retry()
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const parser = createSseParser()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (!live()) return
        if (done) break
        armStale()
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          if (!live()) return
          if (frame.kind === 'comment') {
            if (frame.text === 'open') retries = 0
            continue
          }
          const id = idOf(frame.id)
          if (frame.event === 'replaced') {
            abort()
            whenInHand()
            return
          }
          if (id !== null) since = id
          if (frame.event === 'overflow') on.overflow()
          else if (frame.event === 'message') {
            const e = asEvent(frame.data)
            if (e) on.change(e)
          }
        }
      }
    } catch {
      // A reset or an aborted read: handled below, or not ours any more.
    }
    if (live()) retry()
  }

  void open()

  return {
    close() {
      abort()
      if (retryTimer !== null) deps.clearTimeout(retryTimer)
      retryTimer = null
      stopInHand?.()
      stopInHand = null
    },
  }
}
