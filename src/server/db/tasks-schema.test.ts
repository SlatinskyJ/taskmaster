import { describe, expect, it } from 'vitest'
import { taskScoreChangeApprovals, taskScoreChanges, tasks, templates, users } from './schema'
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

describe('tasks table holds instances (spec §4)', () => {
  function withTemplate() {
    const { db, giver } = setup()
    const templateId = db
      .insert(templates)
      .values({
        title: 'Vynést koše',
        status: 'active',
        score: 4,
        approvalRequired: true,
        scheduleDays: 0,
        scheduleTime: null,
        dueDayOffset: null,
        dueTime: null,
        graceMinutes: null,
        createdBy: giver,
        createdAt: AT,
        updatedAt: AT,
      })
      .returning()
      .get().id
    const row = {
      title: 'Vynést koše',
      status: 'open' as const,
      score: 4,
      approvalRequired: true,
      createdBy: giver,
      createdAt: AT,
      updatedAt: AT,
    }
    return { db, templateId, row }
  }

  it('stores a rejected self-logged instance', () => {
    const { db, templateId, row } = withTemplate()
    db.insert(tasks)
      .values({ ...row, status: 'rejected', origin: 'self_logged', templateId })
      .run()
    expect(db.select().from(tasks).all().at(-1)?.origin).toBe('self_logged')
  })

  it('a row without an origin is a one-time task', () => {
    const { db, row } = withTemplate()
    const r = db.insert(tasks).values(row).returning().get()
    expect(r.origin).toBe('one_time')
    expect(r.templateId).toBeNull()
  })

  it('refuses a one-time task with a template, and an instance without one', () => {
    const { db, templateId, row } = withTemplate()
    expect(() =>
      db
        .insert(tasks)
        .values({ ...row, templateId })
        .run(),
    ).toThrow(/tasks_origin_check/)
    expect(() =>
      db
        .insert(tasks)
        .values({ ...row, origin: 'on_demand' })
        .run(),
    ).toThrow(/tasks_origin_check/)
  })

  it('refuses half a deadline, and a deadline on a one-time task', () => {
    const { db, templateId, row } = withTemplate()
    const instance = { ...row, origin: 'on_demand' as const, templateId }
    expect(() =>
      db
        .insert(tasks)
        .values({ ...instance, dueAt: AT })
        .run(),
    ).toThrow(/tasks_deadline_check/)
    expect(() =>
      db
        .insert(tasks)
        .values({ ...row, dueAt: AT, graceEndsAt: AT })
        .run(),
    ).toThrow(/tasks_deadline_check/)
    db.insert(tasks)
      .values({ ...instance, dueAt: AT, graceEndsAt: AT })
      .run()
  })

  it('still refuses an unknown status', () => {
    const { db, row } = withTemplate()
    expect(() =>
      db
        .insert(tasks)
        .values({ ...row, status: 'teleported' as 'open' })
        .run(),
    ).toThrow(/tasks_status_check/)
  })
})
