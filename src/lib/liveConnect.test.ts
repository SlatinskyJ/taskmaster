import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveEvent } from '~/server/live/functions'
import { connectLive, liveUrl, RETRY_MS, STALE_MS } from './liveConnect'
import type { ConnectDeps } from './liveConnect'

// The tab's stream client (#299): one fetch-based SSE stream with its own retry, so a redeploy
// (502/503), a lost network or a dead socket after sleep never silences the tab for good.

const SUBS = [
  { token: 'a.b', asOf: 3 },
  { token: 'c.d', asOf: 5 },
]

/** Lets pending promise callbacks (fetch, reads) run. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

interface Call {
  url: string
  init: RequestInit
  /** Writes to this call's body. */
  write(text: string): void
  writeBytes(bytes: Uint8Array): void
  end(): void
}

function harness(over: { visible?: boolean } = {}) {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  const calls: Call[] = []
  const answers: (() => Response | Promise<Response>)[] = []
  let visible = over.visible ?? true
  const inHand = new Set<() => void>()
  const got: LiveEvent[] = []
  let overflows = 0

  /** The next fetch answers 200 with a body the test writes to (the default). */
  const streamAnswer = (call: Pick<Call, 'url' | 'init'>): Response => {
    const encoder = new TextEncoder()
    let ctrl!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c
      },
    })
    // As a real fetch does: aborting the request errors its body.
    call.init.signal?.addEventListener('abort', () => {
      try {
        ctrl.error(new DOMException('aborted', 'AbortError'))
      } catch {
        // Already closed.
      }
    })
    calls.push({
      ...call,
      write: (t) => {
        try {
          ctrl.enqueue(encoder.encode(t))
        } catch {
          // Closed.
        }
      },
      writeBytes: (b) => {
        ctrl.enqueue(b)
      },
      end: () => {
        ctrl.close()
      },
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }

  const fetchFn = vi.fn((input: string, init?: RequestInit) => {
    const call = { url: input, init: init ?? {} }
    const answer = answers.shift()
    if (answer) {
      calls.push({
        ...call,
        write: () => undefined,
        writeBytes: () => undefined,
        end: () => undefined,
      })
      return Promise.resolve(answer())
    }
    return Promise.resolve(streamAnswer(call))
  })

  const deps: ConnectDeps = {
    fetch: fetchFn as unknown as typeof fetch,
    setTimeout: (run, ms) => {
      const id = nextId++
      timers.set(id, { at: now + ms, run })
      return id
    },
    clearTimeout: (h) => {
      timers.delete(h as number)
    },
    isVisible: () => visible,
    onInHand: (run) => {
      inHand.add(run)
      return () => {
        inHand.delete(run)
      }
    },
    headers: { 'x-tm-frame': 'tok' },
  }

  const advance = async (ms: number) => {
    const until = now + ms
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      now = due[1].at
      due[1].run()
      await flush()
    }
    now = until
    await flush()
  }

  const connect = () =>
    connectLive(
      SUBS,
      'tab-1',
      {
        change: (e) => got.push(e),
        overflow: () => {
          overflows += 1
        },
      },
      deps,
    )

  return {
    calls,
    fetchFn,
    got,
    overflows: () => overflows,
    timers: () => timers.size,
    inHandCount: () => inHand.size,
    /** The next fetch gets this answer instead of an open stream. */
    answer: (a: () => Response | Promise<Response>) => answers.push(a),
    setVisible: (v: boolean) => {
      visible = v
    },
    fireInHand: async () => {
      for (const run of [...inHand]) run()
      await flush()
    },
    advance,
    connect,
    last: () => {
      const c = calls.at(-1)
      if (!c) throw new Error('no call')
      return c
    },
  }
}

const event = (id: number, change = id, text = `Táta · změna ${String(id)}`): LiveEvent => ({
  id,
  change,
  action: 'task.created',
  entityType: 'task',
  entityId: '1',
  actor: { kind: 'user', userId: 1 },
  at: '2026-11-27T10:00:00.000Z',
  text,
})

const frame = (e: LiveEvent) => `id: ${String(e.id)}\ndata: ${JSON.stringify(e)}\n\n`

const signalOf = (c: Call): AbortSignal => {
  const signal = c.init.signal
  if (!signal) throw new Error('no signal')
  return signal
}

const sinceOf = (url: string) => new URL(url, 'http://x').searchParams.get('since')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('liveUrl', () => {
  it('repeats t, sets tab, sets since only when given', () => {
    expect(liveUrl(SUBS, 'tab-1', null)).toBe('/api/live?t=a.b&t=c.d&tab=tab-1')
    expect(liveUrl(SUBS, 'tab-1', 0)).toBe('/api/live?t=a.b&t=c.d&tab=tab-1&since=0')
    expect(liveUrl(SUBS, 'tab-1', 12)).toBe('/api/live?t=a.b&t=c.d&tab=tab-1&since=12')
  })
})

describe('connectLive: events', () => {
  it('one change per event frame; overflow on event: overflow; the frame header is sent', async () => {
    const h = harness()
    h.connect()
    await flush()
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    expect(sinceOf(h.last().url)).toBeNull()
    expect(h.last().init.headers).toEqual({ 'x-tm-frame': 'tok' })
    expect(h.last().init.cache).toBe('no-store')
    h.last().write(': open\n\n' + frame(event(4)) + frame(event(6, 5)))
    await flush()
    expect(h.got.map((e) => [e.id, e.change])).toEqual([
      [4, 4],
      [6, 5],
    ])
    h.last().write('id: 9\nevent: overflow\ndata: {}\n\n')
    await flush()
    expect(h.overflows()).toBe(1)
    expect(h.got).toHaveLength(2)
  })

  it('malformed data is ignored', async () => {
    const h = harness()
    h.connect()
    await flush()
    h.last().write(
      [
        'id: 1\ndata: not json\n\n',
        'id: 2\ndata: {"id":"2","change":2,"text":"x"}\n\n',
        'id: 3\ndata: {"id":3,"change":"3","text":"x"}\n\n',
        'id: 4\ndata: {"id":4,"change":4,"text":5}\n\n',
        'id: 5\ndata: null\n\n',
        `id: 6\nevent: other\ndata: ${JSON.stringify(event(6))}\n\n`,
      ].join('') + frame(event(7)),
    )
    await flush()
    expect(h.got.map((e) => e.id)).toEqual([7])
    expect(h.overflows()).toBe(0)
  })
  it('a character split between two chunks arrives whole', async () => {
    const h = harness()
    h.connect()
    await flush()
    const bytes = new TextEncoder().encode(frame(event(4, 4, 'Starší · rezervace')))
    const cut = bytes.indexOf(0xc5) + 1
    h.last().writeBytes(bytes.slice(0, cut))
    await flush()
    h.last().writeBytes(bytes.slice(cut))
    await flush()
    expect(h.got.map((e) => e.text)).toEqual(['Starší · rezervace'])
  })
})

describe('connectLive: reconnects', () => {
  it('a clean end retries after RETRY_MS[0]: not at 999 ms, at 1000, with since = the last id', async () => {
    const h = harness()
    h.connect()
    await flush()
    h.last().write(frame(event(4)) + 'id: 8\nevent: overflow\ndata: {}\n\n')
    h.last().end()
    await flush()
    expect(RETRY_MS[0]).toBe(1_000)
    await h.advance(999)
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    await h.advance(1)
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
    expect(sinceOf(h.last().url)).toBe('8')
  })

  it('a many-digit id moves since; an id that is not a whole number does not', async () => {
    const h = harness()
    h.connect()
    await flush()
    h.last().write(
      frame(event(1234)) +
        'id: x5\nevent: overflow\ndata: {}\n\nid: 5x\nevent: overflow\ndata: {}\n\n',
    )
    h.last().end()
    await flush()
    await h.advance(1_000)
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
    expect(sinceOf(h.last().url)).toBe('1234')
  })

  it('a frame without an id does not move since', async () => {
    const h = harness()
    h.connect()
    await flush()
    h.last().write(frame(event(4)) + 'data: {}\n\n')
    h.last().end()
    await flush()
    await h.advance(1_000)
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
    expect(sinceOf(h.last().url)).toBe('4')
  })

  it('the wait grows to 60 s and stays there; `: open` resets it', async () => {
    const h = harness()
    expect(RETRY_MS).toEqual([1_000, 2_000, 5_000, 10_000, 30_000, 60_000])
    h.connect()
    await flush()
    const waits = [...RETRY_MS, 60_000, 60_000]
    for (const [i, ms] of waits.entries()) {
      h.last().end()
      await flush()
      await h.advance(ms - 1)
      expect(h.fetchFn).toHaveBeenCalledTimes(i + 1)
      await h.advance(1)
      expect(h.fetchFn).toHaveBeenCalledTimes(i + 2)
    }
    h.last().write(': ping\n\n')
    h.last().end()
    await flush()
    await h.advance(59_999)
    expect(h.fetchFn).toHaveBeenCalledTimes(waits.length + 1)
    await h.advance(1)
    expect(h.fetchFn).toHaveBeenCalledTimes(waits.length + 2)
    h.last().write(': open\n\n')
    h.last().end()
    await flush()
    await h.advance(999)
    expect(h.fetchFn).toHaveBeenCalledTimes(waits.length + 2)
    await h.advance(1)
    expect(h.fetchFn).toHaveBeenCalledTimes(waits.length + 3)
  })

  it('STALE_MS of silence reconnects: not at 59 999 ms, at 60 000; a ping restarts it', async () => {
    const h = harness()
    expect(STALE_MS).toBe(60_000)
    h.connect()
    await flush()
    const first = h.last()
    first.write(': open\n\n')
    await flush()
    await h.advance(30_000)
    first.write(': ping\n\n')
    await flush()
    await h.advance(59_999)
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    await h.advance(1)
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
    expect(signalOf(first).aborted).toBe(true)
    // The new stream is the one in use: the old one's end does not disturb it.
    h.last().write(frame(event(4)))
    await flush()
    await h.advance(1_000)
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
    expect(h.got.map((e) => e.id)).toEqual([4])
  })

  it('a fetch that never answers counts as silence too', async () => {
    const h = harness()
    h.answer(() => new Promise<Response>(() => undefined))
    h.connect()
    await h.advance(STALE_MS)
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
  })

  it.each([401, 404, 400])('status %i never refetches', async (code) => {
    const h = harness()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    h.answer(() => new Response('refused', { status: code }))
    h.connect()
    await flush()
    await h.advance(10 * 60_000)
    await h.fireInHand()
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    expect(h.timers()).toBe(0)
    if (code === 400) expect(log).toHaveBeenCalledWith('[live] stream refused: 400')
    else expect(log).not.toHaveBeenCalled()
  })

  it.each([
    ['502', () => new Response(null, { status: 502 })],
    ['503', () => new Response(null, { status: 503 })],
    ['a rejected fetch', () => Promise.reject(new TypeError('network'))],
  ])('%s retries after RETRY_MS[0]', async (_, answer) => {
    const h = harness()
    h.answer(answer)
    h.connect()
    await flush()
    await h.advance(999)
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    await h.advance(1)
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
  })

  it('200 without a body retries', async () => {
    const h = harness()
    h.answer(() => new Response(null, { status: 200 }))
    h.connect()
    await flush()
    await h.advance(1_000)
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
  })

  it('a body read error retries', async () => {
    const h = harness()
    h.answer(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.error(new Error('reset'))
            },
          }),
          { status: 200 },
        ),
    )
    h.connect()
    await flush()
    await h.advance(1_000)
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
  })

  it('`replaced` stops and reopens only when the tab is in hand, with since', async () => {
    const h = harness()
    h.connect()
    await flush()
    h.last().write(frame(event(4)) + 'event: replaced\ndata: {}\n\n')
    await flush()
    expect(signalOf(h.last()).aborted).toBe(true)
    await h.advance(10 * 60_000)
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    await h.fireInHand()
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
    expect(sinceOf(h.last().url)).toBe('4')
    expect(h.inHandCount()).toBe(0)
  })

  it('while hidden no retry fires; in hand retries at once', async () => {
    const h = harness({ visible: false })
    h.connect()
    await flush()
    h.last().end()
    await flush()
    await h.advance(10 * 60_000)
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    await h.fireInHand()
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
  })

  it('hidden when the retry falls due: it waits for in hand', async () => {
    const h = harness()
    h.connect()
    await flush()
    h.last().end()
    await flush()
    h.setVisible(false)
    await h.advance(10 * 60_000)
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    h.setVisible(true)
    await h.fireInHand()
    expect(h.fetchFn).toHaveBeenCalledTimes(2)
  })
})

describe('connectLive: close', () => {
  it('aborts the fetch, drops a frame pushed afterwards and leaves no timer', async () => {
    const h = harness()
    const conn = h.connect()
    await flush()
    const call = h.last()
    call.write(': open\n\n')
    await flush()
    conn.close()
    call.write(frame(event(4)))
    await flush()
    expect(signalOf(call).aborted).toBe(true)
    expect(h.got).toEqual([])
    expect(h.timers()).toBe(0)
    await h.advance(10 * 60_000)
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
  })

  it('drops a frame read after close (in the same chunk as the close)', async () => {
    const h = harness()
    let conn: { close(): void } | null = null
    const got: number[] = []
    // close() from inside the first change handler: the second frame of the chunk is dropped.
    conn = connectLive(
      SUBS,
      'tab-1',
      {
        change: (e) => {
          got.push(e.id)
          conn?.close()
        },
        overflow: () => undefined,
      },
      {
        fetch: h.fetchFn as unknown as typeof fetch,
        setTimeout: () => 0,
        clearTimeout: () => undefined,
        isVisible: () => true,
        onInHand: () => () => undefined,
        headers: {},
      },
    )
    await flush()
    h.last().write(frame(event(1)) + frame(event(2)))
    await flush()
    expect(got).toEqual([1])
  })

  it('close while a retry waits: no fetch, no timer, no in-hand listener', async () => {
    const h = harness({ visible: false })
    const conn = h.connect()
    await flush()
    h.last().end()
    await flush()
    expect(h.inHandCount()).toBe(1)
    conn.close()
    expect(h.inHandCount()).toBe(0)
    expect(h.timers()).toBe(0)
    await h.fireInHand()
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
  })

  it('close while the backoff runs: no fetch, no timer', async () => {
    const h = harness()
    const conn = h.connect()
    await flush()
    h.last().end()
    await flush()
    expect(h.timers()).toBe(1)
    conn.close()
    expect(h.timers()).toBe(0)
    await h.advance(10 * 60_000)
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
  })

  it('close while the fetch is pending and it then fails: no retry', async () => {
    const h = harness()
    let reject!: (e: Error) => void
    h.answer(() => new Promise<Response>((_, r) => (reject = r)))
    const conn = h.connect()
    await flush()
    conn.close()
    reject(new DOMException('aborted', 'AbortError'))
    await flush()
    expect(h.timers()).toBe(0)
    await h.advance(10 * 60_000)
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
  })

  it('close while the fetch is pending: its answer is ignored', async () => {
    const h = harness()
    let resolve!: (r: Response) => void
    h.answer(() => new Promise<Response>((r) => (resolve = r)))
    const conn = h.connect()
    await flush()
    conn.close()
    resolve(new Response(null, { status: 502 }))
    await flush()
    await h.advance(10 * 60_000)
    expect(h.fetchFn).toHaveBeenCalledTimes(1)
    expect(h.timers()).toBe(0)
  })
})
