import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { taskThread } from '~/server/db/schema'
import { family, rawTask, T1, T2 } from './testing'
import type { Family } from './testing'

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
