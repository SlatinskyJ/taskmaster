import { parseIsoUtc } from '~/domain/dates'
import type { Features } from '~/lib/features'
import type { CurrentUser } from '~/server/auth'
import type { Hub, LiveEvent, Stream } from './hub'
import { readSubscription } from './subscription'
import { TOPIC_LIMIT } from './topics'
import type { Topic } from './topics'

// The stream endpoint's core (#299), framework-light so tests run without HTTP: the route
// (src/routes/api/live.ts) reads the request and passes it in. Server-Sent Events over the
// app's ordinary HTTPS response; ./README.md has the wire format.

/** A comment every 25 s: production's Apache closes requests idle for 60 s (`ProxyTimeout`). */
export const HEARTBEAT_MS = 25_000
/** Most changes a reconnect replays one by one; more become one `overflow` event. */
export const CATCH_UP_LIMIT = 100

export interface StreamRequest {
  /** The `t` query values: signed subscriptions (./subscription.ts). */
  tokens: string[]
  /** The `since` query value, as sent. */
  since: string | null
  /** The `Last-Event-ID` header, as sent (the browser's, on a reconnect). */
  lastEventId: string | null
  /** The `tab` query value: the tab's id (src/lib/tab.ts). */
  tab: string | null
}

export interface StreamDeps {
  hub: Hub
  features: Features
  /** The request's signed-in user, or null. */
  currentUser: CurrentUser | null
  /** The request's session token (the subscriptions' key), or undefined. */
  sessionKey: string | undefined
  /** The session behind a token as stored, without sliding it. */
  findSession: (key: string) => { id: number; userId: number; expiresAt: string } | undefined
  now: () => Date
  setInterval: (run: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
}

const HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-store',
  'x-accel-buffering': 'no',
}

const status = (code: number) =>
  new Response(null, { status: code, headers: { 'cache-control': 'no-store' } })

/** A non-negative safe integer as sent, `undefined` for none, null for anything else. */
function idParam(value: string | null): number | undefined | null {
  if (value === null) return undefined
  if (!/^\d{1,16}$/.test(value)) return null
  const n = Number(value)
  return Number.isSafeInteger(n) ? n : null
}

const frame = (e: LiveEvent) => `id: ${String(e.id)}\ndata: ${JSON.stringify(e)}\n\n`

export function openStream(req: StreamRequest, deps: StreamDeps): Response {
  if (!deps.features.liveChanges) return status(404)
  const user = deps.currentUser
  const key = deps.sessionKey
  const session = key ? deps.findSession(key) : undefined
  if (!user || !key || session?.userId !== user.id) return status(401)

  const subs = req.tokens.map((t) => readSubscription(key, t))
  if (subs.length === 0) return status(401)
  const topics = new Set<Topic>()
  let asOf = Number.POSITIVE_INFINITY
  for (const sub of subs) {
    if (sub?.userId !== user.id) return status(401)
    for (const t of sub.topics) topics.add(t)
    asOf = Math.min(asOf, sub.asOf)
  }

  const since = idParam(req.since)
  const lastEventId = idParam(req.lastEventId)
  const tab = req.tab
  if (since === null || lastEventId === null || !tab || tab.length > 64) return status(400)
  if (topics.size > TOPIC_LIMIT) return status(400)

  // Never older than the data the tokens were issued with.
  const start = Math.max(lastEventId ?? since ?? asOf, asOf)

  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let timer: unknown = null
  let ended = false
  let detach: (() => void) | null = null

  const end = () => {
    if (ended) return
    ended = true
    if (timer !== null) deps.clearInterval(timer)
    detach?.()
    try {
      controller.close()
    } catch {
      // Already closed or cancelled.
    }
  }

  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
    cancel() {
      end()
    },
  })
  const write = (text: string) => {
    controller.enqueue(encoder.encode(text))
  }

  // Catch-up and attach in one synchronous block: no flush can fall between them.
  const caught = deps.hub.changesSince(start, topics, CATCH_UP_LIMIT)
  const stream: Stream = {
    sessionId: session.id,
    userId: user.id,
    tab,
    topics,
    send(e) {
      write(frame(e))
    },
    close: end,
  }
  detach = deps.hub.attach(stream, caught.lastId)
  if (!detach) {
    ended = true
    return status(503)
  }
  if (caught.overflow) write(`id: ${String(caught.lastId)}\nevent: overflow\ndata: {}\n\n`)
  else for (const e of caught.events) write(frame(e))

  timer = deps.setInterval(() => {
    const now = deps.findSession(key)
    if (now?.userId !== user.id || parseIsoUtc(now.expiresAt) <= deps.now()) {
      end()
      return
    }
    try {
      write(': ping\n\n')
    } catch {
      end()
    }
  }, HEARTBEAT_MS)

  return new Response(body, { status: 200, headers: HEADERS })
}
