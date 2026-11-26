import { afterEach, describe, expect, it, vi } from 'vitest'
import { withAudit, writeAudit } from '~/server/audit'
import type { AuditEntry } from '~/server/audit'
import { disputes, pointAdjustments, settlements } from '~/server/db/schema'
import { MEETING, week } from '~/server/settlement/testing'
import { createHub, STREAMS_PER_SESSION, STREAMS_TOTAL } from './hub'
import type { Hub, LiveEvent, Stream } from './hub'
import * as mapping from './mapping'
import { idTopic } from './topics'
import type { Topic } from './topics'

// The in-process hub (#299): committed changes to matching streams, once, grouped.

type F = ReturnType<typeof week>

/** Two settlement rows of P1, Starší's and Mladší's. */
function settlementsIn(f: ReturnType<typeof week>): [number, number] {
  const one = (takerId: number) =>
    f.db
      .insert(settlements)
      .values({
        periodId: f.p1.id,
        takerId,
        totalBefore: 60,
        level: 'lower',
        deducted: 50,
        carryOver: 10,
        settledBy: f.tata,
        settledAt: MEETING.toISOString(),
      })
      .returning()
      .get().id
  return [one(f.starsi), one(f.mladsi)]
}

/** Lets the hub's microtask flush run (and the audit run end). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** The family with P1 rolled, its audit run over (the next write starts a new change). */
async function setup(): Promise<F> {
  const f = week()
  await settle()
  return f
}

interface Fake extends Stream {
  got: LiveEvent[]
  closed: boolean
}

let n = 0
function stream(topics: Topic[], over: Partial<Stream> = {}): Fake {
  n += 1
  const s: Fake = {
    sessionId: n,
    userId: 1,
    tab: `tab-${String(n)}`,
    topics: new Set(topics),
    got: [],
    closed: false,
    send(e) {
      s.got.push(e)
    },
    close() {
      s.closed = true
    },
    ...over,
  }
  return s
}

const hubs: Hub[] = []
function hubOf(f: F, origin?: () => string | undefined): Hub {
  const hub = createHub(f.db, { originTab: origin ?? (() => undefined) })
  hubs.push(hub)
  return hub
}
afterEach(() => {
  for (const h of hubs.splice(0)) h.stop()
})

function taskEntry(f: F, taskId: number, over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    actor: { kind: 'user', userId: f.tata },
    action: 'task.created',
    entityType: 'task',
    entityId: taskId,
    at: MEETING,
    ...over,
  }
}

/** One committed change: entries on task 77 (topic `task:77`, `tasks`, `week`). */
function change(f: F, entries: AuditEntry | AuditEntry[] = taskEntry(f, 77)): void {
  withAudit(f.db, () => undefined, entries)
}

describe('delivery', () => {
  it('a committed change reaches a stream with a matching topic once', async () => {
    const f = await setup()
    const hub = hubOf(f)
    const s = stream(['task:77'])
    hub.attach(s, 0)
    change(f)
    await settle()
    await settle()
    expect(s.got).toHaveLength(1)
    expect(s.got[0]).toMatchObject({ action: 'task.created', entityType: 'task', entityId: '77' })
  })

  it('a stream without a shared topic gets nothing', async () => {
    const f = await setup()
    const hub = hubOf(f)
    const s = stream(['task:78', 'people'])
    hub.attach(s, 0)
    change(f)
    await settle()
    expect(s.got).toEqual([])
  })

  it('a rolled-back withAudit sends nothing', async () => {
    const f = await setup()
    const hub = hubOf(f)
    const s = stream(['tasks'])
    hub.attach(s, 0)
    expect(() =>
      withAudit(
        f.db,
        (tx) => {
          tx.transaction((inner) => {
            writeAudit(inner, taskEntry(f, 77))
          })
          throw new Error('boom')
        },
        taskEntry(f, 77),
      ),
    ).toThrow('boom')
    await settle()
    expect(s.got).toEqual([])
    // The next real change still arrives.
    change(f)
    await settle()
    expect(s.got).toHaveLength(1)
  })

  it("settlement with two taker entries is one event; id is the newest entry id; action is the first entry's", async () => {
    const f = await setup()
    const hub = hubOf(f)
    const s = stream([idTopic('points', f.starsi), idTopic('points', f.mladsi)])
    const weekOnly = stream(['week'])
    hub.attach(s, 0)
    hub.attach(weekOnly, 0)
    const [a, b] = settlementsIn(f)
    change(f, [
      { ...taskEntry(f, a), action: 'settlement.created', entityType: 'settlement' },
      { ...taskEntry(f, b), action: 'settlement.created', entityType: 'settlement' },
      { ...taskEntry(f, f.p1.id), action: 'period.ended', entityType: 'period' },
    ])
    await settle()
    expect(s.got).toHaveLength(1)
    const e = s.got[0]
    expect(e?.action).toBe('settlement.created')
    expect(e?.entityId).toBe(String(a))
    expect(e?.id).toBe((e?.change ?? 0) + 2)
    // A week-only stream sees the change through the period's entry, never a settlement's.
    expect(weekOnly.got.map((g) => [g.action, g.id])).toEqual([['period.ended', e?.id]])
  })

  it('the origin tab is skipped; another tab of the same user gets it', async () => {
    const f = await setup()
    let tab: string | undefined = 'tab-A'
    const hub = hubOf(f, () => tab)
    const mine = stream(['tasks'], { sessionId: 1, userId: f.tata, tab: 'tab-A' })
    const other = stream(['tasks'], { sessionId: 2, userId: f.tata, tab: 'tab-B' })
    hub.attach(mine, 0)
    hub.attach(other, 0)
    change(f)
    tab = undefined
    await settle()
    expect(mine.got).toEqual([])
    expect(other.got).toHaveLength(1)
  })

  it('scheduler change (no request, actor system) reaches everyone matching', async () => {
    const f = await setup()
    const hub = hubOf(f)
    const a = stream(['week'])
    const b = stream(['tasks'])
    hub.attach(a, 0)
    hub.attach(b, 0)
    change(f, taskEntry(f, 77, { actor: { kind: 'system' }, action: 'instance.expired' }))
    await settle()
    for (const s of [a, b]) {
      expect(s.got).toHaveLength(1)
      expect(s.got[0]?.actor).toEqual({ kind: 'system' })
    }
  })

  it.each(['correction first', 'dispute first'] as const)(
    "a dispute.corrected change for starsi (%s): nothing on week, his brother's points get nothing, starsi's points and disputes get one event",
    async (order) => {
      const f = await setup()
      const hub = hubOf(f)
      const brother = stream(['week', idTopic('points', f.mladsi)])
      const starsi = stream([idTopic('points', f.starsi)])
      const admin = stream(['disputes'])
      for (const s of [brother, starsi, admin]) hub.attach(s, 0)
      const adj = f.db
        .insert(pointAdjustments)
        .values({
          takerId: f.starsi,
          points: 2,
          reason: 'Oprava.',
          madeBy: f.admin,
          madeAt: MEETING.toISOString(),
        })
        .returning()
        .get().id
      const dispute = f.db
        .insert(disputes)
        .values({
          itemKind: 'adjustment',
          itemId: adj,
          openedBy: f.starsi,
          reason: 'Málo.',
          openedAt: MEETING.toISOString(),
          status: 'open',
        })
        .returning()
        .get().id
      const adminActor = { kind: 'user', userId: f.admin } as const
      const points = taskEntry(f, adj, {
        actor: adminActor,
        action: 'points.adjusted',
        entityType: 'adjustment',
      })
      const corrected = taskEntry(f, dispute, {
        actor: adminActor,
        action: 'dispute.corrected',
        entityType: 'dispute',
        after: { status: 'corrected', correction: { kind: 'adjustment', id: adj } },
      })
      change(f, order === 'correction first' ? [points, corrected] : [corrected, points])
      await settle()
      expect(brother.got).toEqual([])
      expect(starsi.got).toHaveLength(1)
      expect(admin.got).toHaveLength(1)
      expect(admin.got[0]).toMatchObject({ action: 'dispute.corrected', entityId: String(dispute) })
      // Starsi sees the change through its first entry on his points, whichever that is.
      expect(starsi.got[0]?.action).toBe(
        order === 'correction first' ? 'points.adjusted' : 'dispute.corrected',
      )
      expect(starsi.got[0]?.id).toBe(admin.got[0]?.id)
    },
  )

  it('every event has exactly the LiveEvent keys', async () => {
    const f = await setup()
    const hub = hubOf(f)
    const s = stream(['task:77'])
    hub.attach(s, 0)
    change(f, taskEntry(f, 77, { before: { secret: 1 }, after: { score: 5 }, reason: 'x' }))
    await settle()
    expect(Object.keys(s.got[0] ?? {}).sort()).toEqual(
      ['action', 'actor', 'at', 'change', 'entityId', 'entityType', 'id'].sort(),
    )
  })
})

describe('nothing twice, nothing lost', () => {
  it('a stream attached after a commit but before its flush gets the change once', async () => {
    const f = await setup()
    const hub = hubOf(f)
    const since = hub.changesSince(0, new Set(), 1).lastId
    change(f)
    const s = stream(['tasks'])
    // Catch-up first (what the stream endpoint does), then attach from its last id.
    const caught = hub.changesSince(since, s.topics, 100)
    for (const e of caught.events) s.send(e)
    hub.attach(s, caught.lastId)
    await settle()
    expect(s.got).toHaveLength(1)
  })

  it('topicsOf throwing for one row: no throw out of flush, the next change is still delivered', async () => {
    const f = await setup()
    const hub = hubOf(f)
    const s = stream(['tasks'])
    hub.attach(s, 0)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const spy = vi.spyOn(mapping, 'topicsOf').mockImplementationOnce(() => {
      throw new Error('mapping')
    })
    try {
      change(f)
      await settle()
      change(f)
      await settle()
      expect(error).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
      error.mockRestore()
    }
    expect(s.got).toHaveLength(1)
  })

  it('a stream whose send throws is detached; the other streams of that change still get it', async () => {
    const f = await setup()
    const hub = hubOf(f)
    const bad = stream(['tasks'], {
      send() {
        throw new Error('gone')
      },
    })
    const good = stream(['tasks'])
    hub.attach(bad, 0)
    hub.attach(good, 0)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      change(f)
      await settle()
    } finally {
      error.mockRestore()
    }
    expect(good.got).toHaveLength(1)
    expect(hub.size()).toBe(1)
    change(f)
    await settle()
    expect(good.got).toHaveLength(2)
  })
})

describe('limits', () => {
  it('exactly 3 streams of one session all stay open', async () => {
    const f = await setup()
    const hub = hubOf(f)
    const three = [1, 2, 3].map(() => stream(['tasks'], { sessionId: 500 }))
    for (const s of three) expect(hub.attach(s, 0)).not.toBeNull()
    expect(STREAMS_PER_SESSION).toBe(3)
    expect(three.map((s) => s.closed)).toEqual([false, false, false])
    expect(hub.size()).toBe(3)
  })

  it('a fourth stream of one session closes the oldest; another session is untouched', async () => {
    const f = await setup()
    const hub = hubOf(f)
    const other = stream(['tasks'], { sessionId: 600 })
    hub.attach(other, 0)
    const four = [1, 2, 3, 4].map(() => stream(['tasks'], { sessionId: 500 }))
    for (const s of four) hub.attach(s, 0)
    expect(four.map((s) => s.closed)).toEqual([true, false, false, false])
    expect(other.closed).toBe(false)
    expect(hub.size()).toBe(4)
  })

  it('the 50th stream overall is accepted; the 51st is refused', async () => {
    const f = await setup()
    const hub = hubOf(f)
    expect(STREAMS_TOTAL).toBe(50)
    for (let i = 0; i < 49; i++) hub.attach(stream(['tasks']), 0)
    expect(hub.attach(stream(['tasks']), 0)).not.toBeNull()
    expect(hub.attach(stream(['tasks']), 0)).toBeNull()
    expect(hub.size()).toBe(50)
  })

  it('a detached stream frees its place and gets nothing more', async () => {
    const f = await setup()
    const hub = hubOf(f)
    const s = stream(['tasks'])
    const detach = hub.attach(s, 0)
    detach?.()
    expect(hub.size()).toBe(0)
    change(f)
    await settle()
    expect(s.got).toEqual([])
  })
})

describe('changesSince', () => {
  it('changesSince(5, topics) returns changes with newest id > 5 that match, grouped, oldest first', async () => {
    const f = await setup()
    const hub = hubOf(f)
    const base = hub.changesSince(0, new Set(['tasks']), 100).lastId
    for (let i = 0; i < 3; i++) {
      change(f, [taskEntry(f, 70 + i), taskEntry(f, 70 + i, { action: 'task.agreed' })])
      await settle()
    }
    change(f, taskEntry(f, 1, { action: 'user.updated', entityType: 'user' }))
    await settle()
    const got = hub.changesSince(base + 2, new Set<Topic>(['tasks']), 100)
    expect(got.events.map((e) => [e.id, e.change, e.entityId])).toEqual([
      [base + 4, base + 3, '71'],
      [base + 6, base + 5, '72'],
    ])
    expect(got.overflow).toBe(false)
    expect(got.lastId).toBe(base + 7)
  })

  it('a change split by afterId is sent once, by its newest id, with its first entry', async () => {
    const f = await setup()
    const hub = hubOf(f)
    const base = hub.changesSince(0, new Set(['tasks']), 100).lastId
    change(f, [taskEntry(f, 70), taskEntry(f, 71, { action: 'task.agreed' })])
    const got = hub.changesSince(base + 1, new Set<Topic>(['tasks']), 100)
    expect(got.events.map((e) => [e.id, e.entityId, e.action])).toEqual([
      [base + 2, '70', 'task.created'],
    ])
    expect(hub.changesSince(base + 2, new Set<Topic>(['tasks']), 100).events).toEqual([])
  })

  it('overflow past the limit', async () => {
    const f = await setup()
    const hub = hubOf(f)
    const base = hub.changesSince(0, new Set(['tasks']), 100).lastId
    for (let i = 0; i < 3; i++) {
      change(f)
      await settle()
    }
    expect(hub.changesSince(base, new Set<Topic>(['tasks']), 3).overflow).toBe(false)
    const over = hub.changesSince(base, new Set<Topic>(['tasks']), 2)
    expect(over.overflow).toBe(true)
    expect(over.lastId).toBe(base + 3)
  })
})
