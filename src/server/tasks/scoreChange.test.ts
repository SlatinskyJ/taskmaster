import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { taskScoreChangeApprovals, taskScoreChanges } from '~/server/db/schema'
import { openChangeOf } from './changeRows'
import { cancelTask, completeTask, releaseTask, reserveTask } from './lifecycle'
import { acceptOffer, placeBid } from './bidding'
import {
  approveTaskScoreChange,
  declineTaskScoreChange,
  proposeTaskScoreChange,
} from './scoreChange'
import { approveTaskOffer, getTaskDetail, listScoreChangesWaiting } from './tasks'
import type { Family } from './testing'
import {
  T1,
  T2,
  T3,
  addGiver,
  audits,
  car,
  failAuditOn,
  family,
  json,
  lastAudit,
  must,
  row,
} from './testing'

// Changing the score of an agreed one-time task (spec §5.2), saying no (Jakub 2026-11-21).

/** "Umýt auto" at 18, open: Táta offered, Starší agreed. */
function openTask(f: Family): number {
  const id = car(f)
  must(approveTaskOffer(f.db, f.starsi, id, 18, T1))
  return id
}

/** Open, then reserved by Starší. */
function reservedTask(f: Family): number {
  const id = openTask(f)
  must(reserveTask(f.db, f.starsi, id, T1))
  return id
}

const changeId = (f: Family, id: number) => {
  const change = openChangeOf(f.db, id)
  if (!change) throw new Error('no open change')
  return change.id
}
const changes = (f: Family, id: number) =>
  f.db
    .select()
    .from(taskScoreChanges)
    .where(eq(taskScoreChanges.taskId, id))
    .all()
    .map((c) => [c.score, c.closedAs])

describe('an open task: any party proposes, a giver + a taker agree', () => {
  it('Táta proposes 20, Mladší agrees: the task is worth 20', () => {
    const f = family()
    const id = openTask(f)
    must(proposeTaskScoreChange(f.db, f.tata, id, 20, T2))
    expect(row(f.db, id)?.score).toBe(18)
    expect(json(lastAudit(f.db)?.after)).toEqual({ changeId: changeId(f, id), score: 20, from: 18 })
    const cid = changeId(f, id)
    expect(must(approveTaskScoreChange(f.db, f.mladsi, id, cid, T3)).score).toBe(20)
    expect(changes(f, id)).toEqual([[20, 'agreed']])
    expect(audits(f.db, id).slice(-3)).toEqual([
      'task.score_change_proposed',
      'task.score_change_approved',
      'task.score_changed',
    ])
    const changed = lastAudit(f.db)
    expect(changed).toMatchObject({ actorUserId: f.mladsi })
    expect(json(changed?.before)).toEqual({ score: 18 })
    expect(json(changed?.after)).toEqual({ changeId: cid, score: 20 })
  })

  it('a taker proposes; the other taker is not enough, Táta is', () => {
    const f = family()
    const id = openTask(f)
    must(proposeTaskScoreChange(f.db, f.starsi, id, 15, T2))
    const cid = changeId(f, id)
    expect(must(approveTaskScoreChange(f.db, f.mladsi, id, cid, T2)).score).toBe(18)
    expect(must(approveTaskScoreChange(f.db, f.tata, id, cid, T3)).score).toBe(15)
  })
})

describe('a reserved task: its taker + a giver', () => {
  it('Táta proposes; Mladší cannot agree, Starší can', () => {
    const f = family()
    const id = reservedTask(f)
    must(proposeTaskScoreChange(f.db, f.tata, id, 20, T2))
    const cid = changeId(f, id)
    expect(approveTaskScoreChange(f.db, f.mladsi, id, cid, T2)).toEqual({
      ok: false,
      error: 'not_involved',
    })
    expect(row(f.db, id)?.score).toBe(18)
    expect(must(approveTaskScoreChange(f.db, f.starsi, id, cid, T3))).toMatchObject({
      score: 20,
      status: 'reserved',
      reservedBy: f.starsi,
    })
  })

  it('Mladší and the admin cannot propose; on an open task the admin is no party', () => {
    const f = family()
    const id = reservedTask(f)
    for (const who of [f.mladsi, f.admin]) {
      expect(proposeTaskScoreChange(f.db, who, id, 20, T2)).toEqual({
        ok: false,
        error: 'not_involved',
      })
    }
    expect(proposeTaskScoreChange(f.db, f.admin, openTask(f), 20, T2)).toEqual({
      ok: false,
      error: 'not_a_party',
    })
  })
})

describe('when a change is refused', () => {
  it('proposed, done, same score, second change, bad score, unknown task', () => {
    const f = family()
    const proposed = car(f)
    expect(proposeTaskScoreChange(f.db, f.tata, proposed, 20, T1)).toEqual({
      ok: false,
      error: 'not_agreed',
    })
    const done = openTask(f)
    must(completeTask(f.db, f.starsi, done, T1))
    expect(proposeTaskScoreChange(f.db, f.tata, done, 20, T2)).toEqual({
      ok: false,
      error: 'score_frozen',
    })
    const id = openTask(f)
    expect(proposeTaskScoreChange(f.db, f.tata, id, 18, T2)).toEqual({
      ok: false,
      error: 'same_score',
    })
    expect(proposeTaskScoreChange(f.db, f.tata, id, 0, T2)).toEqual({
      ok: false,
      error: 'invalid_score',
    })
    must(proposeTaskScoreChange(f.db, f.tata, id, 20, T2))
    expect(proposeTaskScoreChange(f.db, f.starsi, id, 25, T2)).toEqual({
      ok: false,
      error: 'change_pending',
    })
    expect(proposeTaskScoreChange(f.db, f.tata, 999, 20, T2)).toEqual({
      ok: false,
      error: 'not_found',
    })
  })

  it('a stale screen: none open → no_change; another one open → offer_changed', () => {
    const f = family()
    const id = openTask(f)
    must(proposeTaskScoreChange(f.db, f.tata, id, 20, T2))
    const old = changeId(f, id)
    must(declineTaskScoreChange(f.db, f.tata, id, old, T2))
    expect(approveTaskScoreChange(f.db, f.starsi, id, old, T3)).toEqual({
      ok: false,
      error: 'no_change',
    })
    must(proposeTaskScoreChange(f.db, f.tata, id, 22, T3))
    expect(approveTaskScoreChange(f.db, f.starsi, id, old, T3)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    expect(declineTaskScoreChange(f.db, f.starsi, id, old, T3)).toEqual({
      ok: false,
      error: 'offer_changed',
    })
    expect(row(f.db, id)?.score).toBe(18)
  })
})

describe('saying no (Jakub 2026-11-21: only who it waits for)', () => {
  it('Mladší cannot turn down Starší’s proposal: it stays open, nothing logged', () => {
    const f = family()
    const id = openTask(f)
    must(proposeTaskScoreChange(f.db, f.starsi, id, 15, T2))
    const before = audits(f.db, id).length
    expect(declineTaskScoreChange(f.db, f.mladsi, id, changeId(f, id), T3)).toEqual({
      ok: false,
      error: 'not_involved',
    })
    expect(changes(f, id)).toEqual([[15, null]])
    expect(audits(f.db, id)).toHaveLength(before)
  })

  it('Mladší declines Táta’s proposal; Táta withdraws his next; then a new one may start', () => {
    const f = family()
    const id = openTask(f)
    must(proposeTaskScoreChange(f.db, f.tata, id, 20, T2))
    must(declineTaskScoreChange(f.db, f.mladsi, id, changeId(f, id), T2))
    expect(lastAudit(f.db)).toMatchObject({
      action: 'task.score_change_declined',
      actorUserId: f.mladsi,
    })
    must(proposeTaskScoreChange(f.db, f.tata, id, 22, T3))
    must(declineTaskScoreChange(f.db, f.tata, id, changeId(f, id), T3))
    expect(lastAudit(f.db)?.action).toBe('task.score_change_withdrawn')
    expect(changes(f, id)).toEqual([
      [20, 'declined'],
      [22, 'withdrawn'],
    ])
    expect(row(f.db, id)?.score).toBe(18)
    must(proposeTaskScoreChange(f.db, f.starsi, id, 25, T3))
  })
})

describe('a change in flight is discarded once the task cannot change score', () => {
  it('Starší marks it done: discarded before the completion is logged, score stays', () => {
    const f = family()
    const id = reservedTask(f)
    must(proposeTaskScoreChange(f.db, f.tata, id, 20, T2))
    must(completeTask(f.db, f.starsi, id, T3))
    expect(changes(f, id)).toEqual([[20, 'discarded']])
    expect(audits(f.db, id).slice(-2)).toEqual(['task.score_change_discarded', 'task.completed'])
    expect(row(f.db, id)?.score).toBe(18)
  })

  it('a bid-won task released back to negotiation: discarded', () => {
    const f = family()
    const id = car(f)
    must(placeBid(f.db, f.starsi, id, 25, T1))
    must(acceptOffer(f.db, f.starsi, id, 18, T1))
    must(proposeTaskScoreChange(f.db, f.starsi, id, 20, T2))
    must(releaseTask(f.db, f.starsi, id, T3))
    expect(row(f.db, id)?.status).toBe('proposed')
    expect(changes(f, id)).toEqual([[20, 'discarded']])
  })

  it('a tap reservation released back to open keeps the change', () => {
    const f = family()
    const id = reservedTask(f)
    must(proposeTaskScoreChange(f.db, f.tata, id, 20, T2))
    must(releaseTask(f.db, f.starsi, id, T3))
    expect(changes(f, id)).toEqual([[20, null]])
  })
})

describe('a failed audit write rolls everything back', () => {
  it('propose leaves no change', () => {
    const f = family()
    const id = openTask(f)
    failAuditOn(f.db, 'task.score_change_proposed')
    expect(() => proposeTaskScoreChange(f.db, f.tata, id, 20, T2)).toThrow(/audit down/)
    expect(changes(f, id)).toEqual([])
  })

  it('agreeing leaves the old score, the change open and no approval', () => {
    const f = family()
    const id = openTask(f)
    must(proposeTaskScoreChange(f.db, f.tata, id, 20, T2))
    const cid = changeId(f, id)
    failAuditOn(f.db, 'task.score_changed')
    expect(() => approveTaskScoreChange(f.db, f.mladsi, id, cid, T3)).toThrow(/audit down/)
    expect(row(f.db, id)?.score).toBe(18)
    expect(changes(f, id)).toEqual([[20, null]])
    const approvals = f.db
      .select()
      .from(taskScoreChangeApprovals)
      .where(eq(taskScoreChangeApprovals.changeId, cid))
      .all()
    expect(approvals.map((a) => a.userId)).toEqual([f.tata])
  })

  it('a discard during Hotovo leaves the task reserved and the change open', () => {
    const f = family()
    const id = reservedTask(f)
    must(proposeTaskScoreChange(f.db, f.tata, id, 20, T2))
    failAuditOn(f.db, 'task.score_change_discarded')
    expect(() => completeTask(f.db, f.starsi, id, T3)).toThrow(/audit down/)
    expect(row(f.db, id)?.status).toBe('reserved')
    expect(changes(f, id)).toEqual([[20, null]])
  })
})

describe('what screens see', () => {
  it('"Čeká na tebe": the brothers, not Táta or the admin, until agreed', () => {
    const f = family()
    const id = openTask(f)
    must(proposeTaskScoreChange(f.db, f.tata, id, 20, T2))
    const ids = (userId: number) => listScoreChangesWaiting(f.db, userId).map((t) => t.id)
    expect(ids(f.starsi)).toEqual([id])
    expect(ids(f.mladsi)).toEqual([id])
    expect(ids(f.tata)).toEqual([])
    expect(ids(f.admin)).toEqual([])
    must(approveTaskScoreChange(f.db, f.starsi, id, changeId(f, id), T3))
    expect(ids(f.mladsi)).toEqual([])
  })

  it('the task view carries the change, waiting for the side that has not said yes', () => {
    const f = family()
    const mama = addGiver(f)
    const id = openTask(f)
    expect(getTaskDetail(f.db, id)?.task.scoreChange).toBeNull()
    must(proposeTaskScoreChange(f.db, f.starsi, id, 15, T2))
    expect(getTaskDetail(f.db, id)?.task.scoreChange).toEqual({
      id: changeId(f, id),
      score: 15,
      proposedBy: { id: f.starsi, name: 'Starší' },
      approvedBy: [{ id: f.starsi, name: 'Starší' }],
      waitingFor: [
        { id: f.tata, name: 'Táta' },
        { id: mama, name: 'Máma' },
      ],
    })
  })
})

describe('cancel discards a change in flight', () => {
  it('Táta cancels a task with an open change', () => {
    const f = family()
    const id = openTask(f)
    must(proposeTaskScoreChange(f.db, f.tata, id, 20, T2))
    must(cancelTask(f.db, f.tata, id, undefined, T3))
    expect(changes(f, id)).toEqual([[20, 'discarded']])
    expect(audits(f.db, id).slice(-2)).toEqual(['task.score_change_discarded', 'task.cancelled'])
  })
})
