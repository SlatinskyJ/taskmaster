import { describe, expect, it } from 'vitest'
import { taskScoreChangeApprovals, taskScoreChanges, tasks, users } from './schema'
import { createTestDb } from './testing'

// The DB backs up the one-change-at-a-time rule (spec §5.2): whatever code writes, a task
// never has two open score changes, and a change row that makes no sense can't be stored.
const AT = '2026-11-21T10:00:00.000Z'

function setup() {
  const db = createTestDb()
  const giver = db
    .insert(users)
    .values({ username: 'tata', displayName: 'Táta', role: 'giver', createdAt: AT, updatedAt: AT })
    .returning()
    .get().id
  const taskId = db
    .insert(tasks)
    .values({
      title: 'Umýt auto',
      status: 'open',
      score: 18,
      approvalRequired: true,
      createdBy: giver,
      createdAt: AT,
      updatedAt: AT,
    })
    .returning()
    .get().id
  const change = { taskId, score: 20, proposedBy: giver, createdAt: AT }
  return { db, giver, taskId, change }
}

describe('task_score_changes table', () => {
  it('allows one open change per task, next to any number of closed ones', () => {
    const { db, change } = setup()
    db.insert(taskScoreChanges)
      .values({ ...change, closedAt: AT, closedAs: 'declined' })
      .run()
    db.insert(taskScoreChanges)
      .values({ ...change, closedAt: AT, closedAs: 'agreed' })
      .run()
    db.insert(taskScoreChanges).values(change).run()
    expect(() => db.insert(taskScoreChanges).values(change).run()).toThrow()
  })

  it('refuses a score below 1 and a half-closed row', () => {
    const { db, change } = setup()
    expect(() =>
      db
        .insert(taskScoreChanges)
        .values({ ...change, score: 0 })
        .run(),
    ).toThrow()
    expect(() =>
      db
        .insert(taskScoreChanges)
        .values({ ...change, closedAs: 'agreed' })
        .run(),
    ).toThrow()
    expect(() =>
      db
        .insert(taskScoreChanges)
        .values({ ...change, closedAt: AT })
        .run(),
    ).toThrow()
  })

  it('stores one approval per person and change', () => {
    const { db, giver, change } = setup()
    const changeId = db.insert(taskScoreChanges).values(change).returning().get().id
    db.insert(taskScoreChangeApprovals).values({ changeId, userId: giver, approvedAt: AT }).run()
    expect(() =>
      db.insert(taskScoreChangeApprovals).values({ changeId, userId: giver, approvedAt: AT }).run(),
    ).toThrow()
  })
})
