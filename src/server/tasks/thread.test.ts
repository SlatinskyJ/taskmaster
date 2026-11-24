import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { taskThread } from '~/server/db/schema'
import { approveTaskOffer } from './tasks'
import {
  car,
  failAuditOn,
  family,
  json,
  lastAudit,
  must,
  offerInStep,
  rawTask,
  T0,
  T1,
  T2,
  thread,
} from './testing'
import type { Family } from './testing'
import { lastBids, threadOf } from './thread'

const bid = (f: Family, taskId: number, userId: number, side: 'giver' | 'taker', score: number) =>
  f.db.insert(taskThread).values({ taskId, userId, side, score, createdAt: T1.toISOString() }).run()

describe('task_thread constraints', () => {
  it('one open bid per taker per task; a closed one does not block the next', () => {
    const f = family()
    const id = rawTask(f)
    bid(f, id, f.starsi, 'taker', 25)
    expect(() => bid(f, id, f.starsi, 'taker', 23)).toThrow(/UNIQUE/)
    bid(f, id, f.mladsi, 'taker', 22) // another taker is fine
    f.db
      .update(taskThread)
      .set({ closedAt: T2.toISOString(), closedAs: 'replaced' })
      .where(and(eq(taskThread.userId, f.starsi), eq(taskThread.side, 'taker')))
      .run()
    bid(f, id, f.starsi, 'taker', 23)
  })

  it('one open giver offer per task', () => {
    const f = family()
    const id = rawTask(f)
    bid(f, id, f.tata, 'giver', 18)
    expect(() => bid(f, id, f.tata, 'giver', 20)).toThrow(/UNIQUE/)
  })

  it('score from 1; closed_at and closed_as only together', () => {
    const f = family()
    const id = rawTask(f)
    expect(() => bid(f, id, f.starsi, 'taker', 0)).toThrow(/CHECK/)
    bid(f, id, f.starsi, 'taker', 1)
    expect(() => f.db.update(taskThread).set({ closedAs: 'closed' }).run()).toThrow(/CHECK/)
    expect(() => f.db.update(taskThread).set({ closedAt: T2.toISOString() }).run()).toThrow(/CHECK/)
  })
})

describe('the thread behind path 1', () => {
  it('creating a task writes its first offer', () => {
    const f = family()
    const id = car(f)
    expect(thread(f.db, id)).toEqual([['giver', f.tata, 18, null]])
    expect(threadOf(f.db, id)[0]).toMatchObject({ createdAt: T0.toISOString(), closedAt: null })
    expect(offerInStep(f.db, id)).toBe(true)
  })

  it("a taker's approval closes the offer as accepted and names it in task.agreed", () => {
    const f = family()
    const id = car(f)
    must(approveTaskOffer(f.db, f.starsi, id, 18, T1))
    expect(thread(f.db, id)).toEqual([['giver', f.tata, 18, 'accepted']])
    expect(threadOf(f.db, id)[0]?.closedAt).toBe(T1.toISOString())
    expect(json(lastAudit(f.db)?.before)).toEqual({ status: 'proposed', score: 18, offerRound: 1 })
    expect(json(lastAudit(f.db)?.after)).toEqual({
      status: 'open',
      score: 18,
      offerRound: 1,
      reservedBy: null,
      reservedVia: null,
      reservedGiverId: null,
      accepted: [1],
      closed: [],
    })
  })

  it('a failed audit write leaves the offer open', () => {
    const f = family()
    const id = car(f)
    failAuditOn(f.db, 'task.agreed')
    expect(() => approveTaskOffer(f.db, f.starsi, id, 18, T1)).toThrow(/audit down/)
    expect(thread(f.db, id)).toEqual([['giver', f.tata, 18, null]])
  })
  it('an offer row out of step with the task score fails loudly (Architecture, code round 1)', () => {
    const f = family()
    const id = car(f)
    f.db.update(taskThread).set({ score: 20 }).where(eq(taskThread.taskId, id)).run()
    expect(() => approveTaskOffer(f.db, f.starsi, id, 18, T1)).toThrow(/offer 20 ≠ score 18/)
    expect(offerInStep(f.db, id)).toBe(false)
  })
})

describe('lastBids (same number, Jakub 2026-11-24)', () => {
  const at = (f: Family, taskId: number) => lastBids(f.db, taskId).map((r) => [r.userId, r.score])
  const close = (f: Family, userId: number) =>
    f.db
      .update(taskThread)
      .set({ closedAt: T2.toISOString(), closedAs: 'closed' })
      .where(and(eq(taskThread.userId, userId), eq(taskThread.side, 'taker')))
      .run()

  it("each brother's newest bid since the newest giver row, a closed one included", () => {
    const f = family()
    const id = rawTask(f)
    bid(f, id, f.starsi, 'taker', 5)
    close(f, f.starsi)
    bid(f, id, f.starsi, 'taker', 6)
    bid(f, id, f.mladsi, 'taker', 7)
    close(f, f.mladsi)
    expect(at(f, id)).toEqual([
      [f.starsi, 6],
      [f.mladsi, 7],
    ])
  })

  it('resets after a giver row', () => {
    const f = family()
    const id = rawTask(f)
    bid(f, id, f.starsi, 'taker', 5)
    f.db
      .update(taskThread)
      .set({ closedAt: T2.toISOString(), closedAs: 'replaced' })
      .where(eq(taskThread.side, 'giver'))
      .run()
    bid(f, id, f.tata, 'giver', 4)
    expect(at(f, id)).toEqual([])
  })
})
