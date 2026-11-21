import { describe, expect, it } from 'vitest'
import { writeAudit } from '~/server/audit'
import { acceptOffer, counterOffer, placeBid } from './bidding'
import { cancelTask, completeTask } from './lifecycle'
import { getTaskDetail } from './tasks'
import { T1, T2, T3, car, family, must } from './testing'

// A task's history from the audit log (#36): what happened, by whom, at what score.

describe('task history', () => {
  it('lists the steps in order with who, score and the reserving taker', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(counterOffer(f.db, f.tata, id, 20, [], T2))
    must(acceptOffer(f.db, f.starsi, id, 20, T2))
    must(completeTask(f.db, f.starsi, id, T3))
    const history = getTaskDetail(f.db, id)?.history ?? []
    expect(history.map((h) => [h.action, h.by?.name ?? null, h.score])).toEqual([
      ['task.created', 'Táta', 18],
      ['task.bid_placed', 'Starší', 25],
      ['task.score_countered', 'Táta', 20],
      ['task.score_approved', 'Starší', 20],
      ['task.agreed', 'Starší', 20],
      ['task.completed', 'Starší', 20],
    ])
    expect(history.find((h) => h.action === 'task.agreed')?.reservedBy).toEqual({
      id: f.starsi,
      name: 'Starší',
    })
    expect(history.find((h) => h.action === 'task.completed')?.reservedBy).toBeNull()
  })

  it('carries the reason, and nothing else from the log', () => {
    const f = family()
    const id = car(f)
    must(cancelTask(f.db, f.tata, id, 'Už to udělala máma.', T1))
    const last = getTaskDetail(f.db, id)?.history.at(-1)
    expect(last).toEqual({
      id: expect.any(Number) as unknown,
      at: T1.toISOString(),
      action: 'task.cancelled',
      by: { id: f.tata, name: 'Táta' },
      score: 18,
      reservedBy: null,
      reason: 'Už to udělala máma.',
    })
  })

  it("leaves out another task's entries and other entities with the same id", () => {
    const f = family()
    const id = car(f)
    car(f)
    f.db.transaction((tx) => {
      writeAudit(tx, {
        actor: { kind: 'system' },
        action: 'template.created',
        entityType: 'template',
        entityId: id,
        at: T1,
      })
    })
    expect(getTaskDetail(f.db, id)?.history.map((h) => h.action)).toEqual(['task.created'])
  })
})
