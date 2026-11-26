import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { ALL_FEATURES, NO_FEATURES } from '~/lib/features'
import { withAudit } from '~/server/audit'
import type { AuditEntry } from '~/server/audit'
import { toCurrentUser } from '~/server/auth'
import { createSession, deleteSession, findSession } from '~/server/auth/sessions'
import { sessions, users } from '~/server/db/schema'
import { family, T0 } from '~/server/tasks/testing'
import { createHub } from './hub'
import type { Hub, LiveEvent } from './hub'
import { CATCH_UP_LIMIT, HEARTBEAT_MS, openStream } from './stream'
import type { StreamDeps, StreamRequest } from './stream'
import { signSubscription } from './subscription'
import type { Topic } from './topics'

// The stream endpoint (#299), without HTTP: status codes, catch-up, live events, heartbeat.

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

type F = ReturnType<typeof family>

const hubs: Hub[] = []
afterEach(() => {
  for (const h of hubs.splice(0)) h.stop()
})

async function setup() {
  const f = family()
  const hub = createHub(f.db, { originTab: () => undefined })
  hubs.push(hub)
  const login = (userId: number) => createSession(f.db, userId, 'password', T0).token
  const starsiKey = login(f.starsi)
  const mladsiKey = login(f.mladsi)
  let ping: (() => void) | null = null
  let now = T0
  const user = (id: number) => {
    const row = f.db.select().from(users).where(eq(users.id, id)).get()
    if (!row) throw new Error('no user')
    return toCurrentUser(row)
  }
  const deps = (over: Partial<StreamDeps> = {}): StreamDeps => ({
    hub,
    features: ALL_FEATURES,
    currentUser: user(f.starsi),
    sessionKey: starsiKey,
    findSession: (key) => findSession(f.db, key),
    now: () => now,
    setInterval: (run, ms) => {
      expect(ms).toBe(HEARTBEAT_MS)
      ping = run
      return 1
    },
    clearInterval: () => {
      ping = null
    },
    ...over,
  })
  await settle()
  return {
    f,
    hub,
    starsiKey,
    mladsiKey,
    deps,
    ping: () => ping?.(),
    hasPing: () => ping !== null,
    setNow: (d: Date) => {
      now = d
    },
  }
}

type S = Awaited<ReturnType<typeof setup>>

const sign = (s: S, topics: Topic[], asOf = 0, key = s.starsiKey, userId = s.f.starsi) =>
  signSubscription(key, userId, topics, asOf)

const request = (over: Partial<StreamRequest> & { tokens: string[] }): StreamRequest => ({
  since: null,
  lastEventId: null,
  tab: 'tab-1',
  ...over,
})

function entry(f: F, taskId: number, over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    actor: { kind: 'user', userId: f.tata },
    action: 'task.created',
    entityType: 'task',
    entityId: taskId,
    at: T0,
    ...over,
  }
}

/** One committed change on task `id`, its audit run ended. */
async function change(f: F, id = 77, over: Partial<AuditEntry> = {}) {
  withAudit(f.db, () => undefined, entry(f, id, over))
  await settle()
}

/** Reads what the body has so far, without waiting for more. */
function reader(res: Response) {
  const r = (res.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null
  let done = false
  return {
    async text(): Promise<string> {
      let out = ''
      for (;;) {
        pending ??= r.read()
        const got = await Promise.race([pending, settle().then(() => null)])
        if (got === null) return out
        pending = null
        if (got.done) {
          done = true
          return out
        }
        out += decoder.decode(got.value)
      }
    },
    done: () => done,
    cancel: () => r.cancel(),
  }
}

const events = (text: string): LiveEvent[] =>
  text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)) as LiveEvent)
    .filter((e) => 'id' in e)

describe('refusals', () => {
  it('switch off → 404', async () => {
    const s = await setup()
    const res = openStream(
      request({ tokens: [sign(s, ['tasks'])] }),
      s.deps({ features: NO_FEATURES }),
    )
    expect(res.status).toBe(404)
  })

  it('no session → 401', async () => {
    const s = await setup()
    const tokens = [sign(s, ['tasks'])]
    expect(openStream(request({ tokens }), s.deps({ currentUser: null })).status).toBe(401)
    expect(openStream(request({ tokens }), s.deps({ sessionKey: undefined })).status).toBe(401)
  })

  it('no token → 401', async () => {
    const s = await setup()
    expect(openStream(request({ tokens: [] }), s.deps()).status).toBe(401)
  })

  it('token of another user → 401', async () => {
    const s = await setup()
    // Mladší's own token, replayed with Starší's session.
    const token = sign(s, ['tasks'], 0, s.mladsiKey, s.f.mladsi)
    expect(openStream(request({ tokens: [token] }), s.deps()).status).toBe(401)
    // Signed with Starší's key but for Mladší.
    const forged = sign(s, ['tasks'], 0, s.starsiKey, s.f.mladsi)
    expect(openStream(request({ tokens: [forged] }), s.deps()).status).toBe(401)
  })

  it('same user, edited topic list → 401', async () => {
    const s = await setup()
    const [payload = '', sig = ''] = sign(s, ['tasks']).split('.')
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { t: string[] }
    data.t.push('disputes')
    const edited = `${Buffer.from(JSON.stringify(data)).toString('base64url')}.${sig}`
    expect(openStream(request({ tokens: [edited] }), s.deps()).status).toBe(401)
  })

  it("same user, token signed with another session's key → 401", async () => {
    const s = await setup()
    const otherKey = createSession(s.f.db, s.f.starsi, 'password', T0).token
    const token = sign(s, ['tasks'], 0, otherKey)
    expect(openStream(request({ tokens: [token] }), s.deps()).status).toBe(401)
  })

  it('one good token + one bad token → 401', async () => {
    const s = await setup()
    const tokens = [sign(s, ['tasks']), `${sign(s, ['week'])}x`]
    expect(openStream(request({ tokens }), s.deps()).status).toBe(401)
  })

  it('exactly 20 topics → 200; two tokens with 12 each, 20 distinct → 200; 21 distinct → 400', async () => {
    const s = await setup()
    const ids = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => `task:${String(from + i)}` as Topic)
    const ok = openStream(request({ tokens: [sign(s, ids(1, 20))] }), s.deps())
    expect(ok.status).toBe(200)
    const two = openStream(
      request({ tokens: [sign(s, ids(1, 12)), sign(s, ids(9, 12))] }),
      s.deps(),
    )
    expect(two.status).toBe(200)
    const over = openStream(
      request({ tokens: [sign(s, ids(1, 12)), sign(s, ids(10, 12))] }),
      s.deps(),
    )
    expect(over.status).toBe(400)
  })

  it('a missing tab → 400', async () => {
    const s = await setup()
    const res = openStream(request({ tokens: [sign(s, ['tasks'])], tab: null }), s.deps())
    expect(res.status).toBe(400)
  })

  it.each(['-1', '1.5', 'abc', '1e400', '', '99999999999999999'])(
    'since or Last-Event-ID of %j → 400',
    async (bad) => {
      const s = await setup()
      const tokens = [sign(s, ['tasks'])]
      expect(openStream(request({ tokens, since: bad }), s.deps()).status).toBe(400)
      expect(openStream(request({ tokens, lastEventId: bad }), s.deps()).status).toBe(400)
    },
  )

  it('the hub refusing attach (STREAMS_TOTAL) → 503', async () => {
    const s = await setup()
    const hub: Hub = { ...s.hub, attach: () => null }
    const res = openStream(request({ tokens: [sign(s, ['tasks'])] }), s.deps({ hub }))
    expect(res.status).toBe(503)
  })

  it('200 with the event-stream headers', async () => {
    const s = await setup()
    const res = openStream(request({ tokens: [sign(s, ['tasks'])] }), s.deps())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-accel-buffering')).toBe('no')
  })
})

describe('catch-up and live events', () => {
  it('catch-up: changes after since are sent first, then a new change live', async () => {
    const s = await setup()
    await change(s.f, 70)
    await change(s.f, 71)
    const res = openStream(request({ tokens: [sign(s, ['tasks'])], since: '1' }), s.deps())
    const body = reader(res)
    expect(events(await body.text()).map((e) => e.entityId)).toEqual(['71'])
    await change(s.f, 72)
    expect(events(await body.text()).map((e) => e.entityId)).toEqual(['72'])
  })

  it('a data: line parses to exactly the LiveEvent keys (live and catch-up; no before / after)', async () => {
    const s = await setup()
    await change(s.f, 70, { before: { x: 1 }, after: { y: 2 }, reason: 'r' })
    const body = reader(openStream(request({ tokens: [sign(s, ['tasks'])] }), s.deps()))
    const caught = events(await body.text())
    await change(s.f, 71, { before: { x: 1 }, after: { y: 2 }, reason: 'r' })
    const live = events(await body.text())
    expect(caught[0]).toStrictEqual({
      id: 1,
      change: 1,
      action: 'task.created',
      entityType: 'task',
      entityId: '70',
      actor: { kind: 'user', userId: s.f.tata },
      at: T0.toISOString(),
    })
    expect(live[0]).toStrictEqual({
      id: 2,
      change: 2,
      action: 'task.created',
      entityType: 'task',
      entityId: '71',
      actor: { kind: 'user', userId: s.f.tata },
      at: T0.toISOString(),
    })
  })

  it('each event line carries its SSE id', async () => {
    const s = await setup()
    await change(s.f, 70)
    const text = await reader(
      openStream(request({ tokens: [sign(s, ['tasks'])] }), s.deps()),
    ).text()
    expect(text.startsWith('id: 1\ndata: {')).toBe(true)
  })

  it('Last-Event-ID 9 beats since 3: nothing ≤ 9 is sent', async () => {
    const s = await setup()
    for (let i = 0; i < 11; i++) await change(s.f, 70 + i)
    const body = reader(
      openStream(request({ tokens: [sign(s, ['tasks'])], since: '3', lastEventId: '9' }), s.deps()),
    )
    expect(events(await body.text()).map((e) => e.id)).toEqual([10, 11])
  })

  it("since below the tokens' asOf starts at asOf", async () => {
    const s = await setup()
    for (let i = 0; i < 4; i++) await change(s.f, 70 + i)
    const tokens = [sign(s, ['tasks'], 3), sign(s, ['week'], 2)]
    const body = reader(openStream(request({ tokens, since: '0' }), s.deps()))
    expect(events(await body.text()).map((e) => e.id)).toEqual([3, 4])
  })

  it('exactly 100 changes to catch up → 100 events, no overflow; 101 → one overflow event, then live', async () => {
    const s = await setup()
    expect(CATCH_UP_LIMIT).toBe(100)
    for (let i = 0; i < 100; i++) await change(s.f, 70)
    const text100 = await reader(
      openStream(request({ tokens: [sign(s, ['tasks'])] }), s.deps()),
    ).text()
    expect(events(text100)).toHaveLength(100)
    expect(text100).not.toContain('overflow')

    await change(s.f, 70)
    const body = reader(openStream(request({ tokens: [sign(s, ['tasks'])] }), s.deps()))
    const text = await body.text()
    expect(text).toBe('id: 101\nevent: overflow\ndata: {}\n\n')
    await change(s.f, 71)
    expect(events(await body.text()).map((e) => [e.id, e.entityId])).toEqual([[102, '71']])
  })
})

describe('heartbeat and the session', () => {
  it('ping every 25 s; an expired session ends the stream at the next ping', async () => {
    const s = await setup()
    const body = reader(openStream(request({ tokens: [sign(s, ['tasks'])] }), s.deps()))
    await body.text()
    s.ping()
    expect(await body.text()).toBe(': ping\n\n')
    s.setNow(new Date(T0.getTime() + 91 * 24 * 60 * 60 * 1000))
    s.ping()
    await body.text()
    expect(body.done()).toBe(true)
    expect(s.hasPing()).toBe(false)
    expect(s.hub.size()).toBe(0)
  })

  it('session deleted (logout) → the stream ends at the next ping', async () => {
    const s = await setup()
    const body = reader(openStream(request({ tokens: [sign(s, ['tasks'])] }), s.deps()))
    await body.text()
    const row = findSession(s.f.db, s.starsiKey)
    if (!row) throw new Error('no session')
    deleteSession(s.f.db, row.id)
    s.ping()
    await body.text()
    expect(body.done()).toBe(true)
    expect(s.hub.size()).toBe(0)
  })

  it("a ping does not move the session's expires_at", async () => {
    const s = await setup()
    const before = s.f.db.select().from(sessions).all()
    const body = reader(openStream(request({ tokens: [sign(s, ['tasks'])] }), s.deps()))
    s.setNow(new Date(T0.getTime() + 2 * 24 * 60 * 60 * 1000))
    s.ping()
    expect(await body.text()).toBe(': ping\n\n')
    expect(s.f.db.select().from(sessions).all()).toEqual(before)
  })

  it('cancelling the body detaches from the hub', async () => {
    const s = await setup()
    const body = reader(openStream(request({ tokens: [sign(s, ['tasks'])] }), s.deps()))
    expect(s.hub.size()).toBe(1)
    await body.cancel()
    expect(s.hub.size()).toBe(0)
    expect(s.hasPing()).toBe(false)
  })
})
