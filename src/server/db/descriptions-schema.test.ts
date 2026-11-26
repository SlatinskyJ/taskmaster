import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { descriptionChanges, tasks, templates, users } from './schema'
import { createTestDb } from './testing'

// The DB backs up one waiting description change per task or template (#207), and a change
// row names exactly one of them.
const AT = '2026-11-26T10:00:00.000Z'

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
      description: 'a\nb',
      status: 'open',
      score: 18,
      approvalRequired: true,
      createdBy: giver,
      createdAt: AT,
      updatedAt: AT,
    })
    .returning()
    .get().id
  const templateId = db
    .insert(templates)
    .values({
      title: 'Vynést koše',
      status: 'active',
      score: 4,
      approvalRequired: true,
      createdBy: giver,
      createdAt: AT,
      updatedAt: AT,
    })
    .returning()
    .get().id
  return { db, giver, taskId, templateId }
}

describe('description_changes table', () => {
  it('names exactly one target', () => {
    const { db, giver, taskId, templateId } = setup()
    const row = { description: 'x', proposedBy: giver, createdAt: AT }
    expect(() =>
      db
        .insert(descriptionChanges)
        .values({ ...row, taskId, templateId })
        .run(),
    ).toThrow(/CHECK/)
    expect(() => db.insert(descriptionChanges).values(row).run()).toThrow(/CHECK/)
  })

  it('allows one open change per task and per template, next to closed ones', () => {
    const { db, giver, taskId, templateId } = setup()
    const row = { description: 'x', proposedBy: giver, createdAt: AT }
    db.insert(descriptionChanges)
      .values({ ...row, taskId, closedAt: AT, closedAs: 'replaced' })
      .run()
    db.insert(descriptionChanges)
      .values({ ...row, taskId })
      .run()
    expect(() =>
      db
        .insert(descriptionChanges)
        .values({ ...row, taskId })
        .run(),
    ).toThrow(/UNIQUE/)
    db.insert(descriptionChanges)
      .values({ ...row, templateId })
      .run()
    expect(() =>
      db
        .insert(descriptionChanges)
        .values({ ...row, templateId })
        .run(),
    ).toThrow(/UNIQUE/)
  })

  it('refuses a half-closed row', () => {
    const { db, giver, taskId } = setup()
    expect(() =>
      db
        .insert(descriptionChanges)
        .values({ taskId, description: null, proposedBy: giver, createdAt: AT, closedAt: AT })
        .run(),
    ).toThrow(/CHECK/)
  })

  it('keeps line breaks in a task description', () => {
    const { db, taskId } = setup()
    expect(db.select().from(tasks).where(eq(tasks.id, taskId)).get()?.description).toBe('a\nb')
  })
})
