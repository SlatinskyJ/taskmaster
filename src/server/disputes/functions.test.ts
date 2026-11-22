import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { disputes, featureFlags } from '~/server/db/schema'
import { doneTask, MEETING, SAT, week } from '~/server/settlement/testing'
import { must } from '~/server/tasks/testing'
import { openDisputeIn } from './disputes'
import {
  disputeListHandler,
  itemMarkHandler,
  openDisputeHandler,
  parseItemMarkRef,
  parseOpenDispute,
} from './functions'

// The dispute server functions (#46): thin wrappers over ./disputes.ts and ./list.ts behind the
// launch switch `disputes`. The handlers are exactly what the server functions run.

function withSwitch(enabled: boolean) {
  const f = week()
  f.db.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, 'disputes')).run()
  const confirmed = doneTask(f, { score: 22, completedAt: SAT, earner: f.starsi })
  return { ...f, confirmed }
}

describe('parseOpenDispute', () => {
  it('takes exactly kind, id and reason; the reason stays as typed', () => {
    expect(parseOpenDispute({ kind: 'completion', id: 3, reason: ' proč ' })).toEqual({
      kind: 'completion',
      id: 3,
      reason: ' proč ',
    })
  })

  it('a reason of 200 characters after trimming passes; 201 is refused', () => {
    expect(parseOpenDispute({ kind: 'rejection', id: 1, reason: ` ${'a'.repeat(200)} ` }).id).toBe(
      1,
    )
    expect(() => parseOpenDispute({ kind: 'rejection', id: 1, reason: 'a'.repeat(201) })).toThrow()
  })

  it.each([
    ['an extra key', { kind: 'completion', id: 1, reason: 'x', by: 2 }],
    ['a missing key', { kind: 'completion', id: 1 }],
    ['kind adjustment (#48)', { kind: 'adjustment', id: 1, reason: 'x' }],
    ['an unknown kind', { kind: 'task', id: 1, reason: 'x' }],
    ['id 0', { kind: 'completion', id: 0, reason: 'x' }],
    ['id 1.5', { kind: 'completion', id: 1.5, reason: 'x' }],
    ['id as text', { kind: 'completion', id: '1', reason: 'x' }],
    ['a reason that is not text', { kind: 'completion', id: 1, reason: 5 }],
    ['not an object', 'completion'],
  ])('refuses %s', (_, data) => {
    expect(() => parseOpenDispute(data)).toThrow(/Invalid input/)
  })
})

describe('parseItemMarkRef', () => {
  it('takes exactly a task score, a template score or a completion, with its id', () => {
    for (const kind of ['task_score', 'template_score', 'completion'] as const) {
      expect(parseItemMarkRef({ kind, id: 4 })).toEqual({ kind, id: 4 })
    }
  })

  it.each([
    ['a settlement', { kind: 'settlement', id: 1 }],
    ['a rejection', { kind: 'rejection', id: 1 }],
    ['an extra key', { kind: 'completion', id: 1, x: 1 }],
    ['id 0', { kind: 'completion', id: 0 }],
  ])('refuses %s', (_, data) => {
    expect(() => parseItemMarkRef(data)).toThrow(/Invalid input/)
  })
})

describe('openDisputeHandler', () => {
  const input = (f: ReturnType<typeof withSwitch>) =>
    ({ kind: 'completion', id: f.confirmed, reason: 'Byl i kufr.' }) as const

  it('switch off: feature_off and nothing written', () => {
    const f = withSwitch(false)
    expect(openDisputeHandler(f.db, f.starsi, input(f), MEETING)).toEqual({
      ok: false,
      error: 'feature_off',
    })
    expect(f.db.select().from(disputes).all()).toEqual([])
  })

  it('switch on: exactly { ok: true }', () => {
    const f = withSwitch(true)
    expect(openDisputeHandler(f.db, f.starsi, input(f), MEETING)).toEqual({ ok: true })
    expect(f.db.select().from(disputes).all()).toHaveLength(1)
  })

  it('passes a refusal through', () => {
    const f = withSwitch(true)
    expect(openDisputeHandler(f.db, f.starsi, { ...input(f), id: 999 }, MEETING)).toEqual({
      ok: false,
      error: 'not_found',
    })
  })
})

describe('itemMarkHandler', () => {
  it('off → feature_off; none → null; open → { status: open }', () => {
    const off = withSwitch(false)
    const viewer = (id: number, role: 'giver' | 'taker' = 'taker') => ({ id, role })
    expect(
      itemMarkHandler(off.db, viewer(off.starsi), { kind: 'completion', id: off.confirmed }),
    ).toEqual({
      error: 'feature_off',
    })
    const f = withSwitch(true)
    const item = { kind: 'completion', id: f.confirmed } as const
    expect(itemMarkHandler(f.db, viewer(f.starsi), item)).toBeNull()
    must(openDisputeIn(f.db, f.starsi, item, 'x', MEETING))
    expect(itemMarkHandler(f.db, viewer(f.starsi), item)).toEqual({ status: 'open' })
  })

  it('a completion’s mark (with the admin’s note) only for a giver, its earner and whoever opened it', () => {
    const f = withSwitch(true)
    const viewer = (id: number, role: 'giver' | 'taker' = 'taker') => ({ id, role })
    const item = { kind: 'completion', id: f.confirmed } as const
    const id = must(openDisputeIn(f.db, f.starsi, item, 'x', MEETING)).id
    f.db
      .update(disputes)
      .set({
        status: 'dismissed',
        resolvedBy: f.admin,
        resolvedAt: MEETING.toISOString(),
        note: 'Ne.',
      })
      .where(eq(disputes.id, id))
      .run()
    const kept = { status: 'dismissed', note: 'Ne.' }
    expect(itemMarkHandler(f.db, viewer(f.starsi), item)).toEqual(kept)
    expect(itemMarkHandler(f.db, viewer(f.tata, 'giver'), item)).toEqual(kept)
    expect(itemMarkHandler(f.db, viewer(f.mladsi), item)).toBeNull()
    const other = doneTask(f, { score: 3, completedAt: SAT, earner: f.starsi })
    const byMladsi = { kind: 'completion', id: other } as const
    must(openDisputeIn(f.db, f.mladsi, byMladsi, 'x', MEETING))
    expect(itemMarkHandler(f.db, viewer(f.mladsi), byMladsi)).toEqual({ status: 'open' })
  })

  it('the earner sees the mark of a dispute Táta opened on his completion', () => {
    const f = withSwitch(true)
    const item = { kind: 'completion', id: f.confirmed } as const
    must(openDisputeIn(f.db, f.tata, item, 'x', MEETING))
    expect(itemMarkHandler(f.db, { id: f.starsi, role: 'taker' }, item)).toEqual({ status: 'open' })
    expect(itemMarkHandler(f.db, { id: f.mladsi, role: 'taker' }, item)).toBeNull()
  })

  it('the admin gets no mark (not a party), not even on a score', () => {
    const f = withSwitch(true)
    const item = { kind: 'task_score', id: f.confirmed } as const
    must(openDisputeIn(f.db, f.starsi, item, 'x', MEETING))
    expect(itemMarkHandler(f.db, { id: f.admin, role: 'admin' }, item)).toBeNull()
  })

  it('a score’s mark is for every party (scores are shared)', () => {
    const f = withSwitch(true)
    const item = { kind: 'task_score', id: f.confirmed } as const
    must(openDisputeIn(f.db, f.starsi, item, 'x', MEETING))
    expect(itemMarkHandler(f.db, { id: f.mladsi, role: 'taker' }, item)).toEqual({ status: 'open' })
  })
})

describe('disputeListHandler', () => {
  it('off → feature_off; on → the viewer’s list', () => {
    const off = withSwitch(false)
    expect(disputeListHandler(off.db, { id: off.starsi, role: 'taker' })).toEqual({
      error: 'feature_off',
    })
    const f = withSwitch(true)
    must(openDisputeIn(f.db, f.starsi, { kind: 'completion', id: f.confirmed }, 'x', MEETING))
    const list = disputeListHandler(f.db, { id: f.starsi, role: 'taker' })
    expect(Array.isArray(list) && list.map((e) => e.reason)).toEqual(['x'])
  })
})
