import { describe, expect, it } from 'vitest'
import { templates, templateScoreApprovals, users } from './schema'
import { createTestDb } from './testing'

// The DB backs up the domain's checks (spec §5.3): a template row that makes no sense can't be
// stored, whatever code writes it.
const AT = '2026-11-18T10:00:00.000Z'

function setup() {
  const db = createTestDb()
  const giver = db
    .insert(users)
    .values({ username: 'tata', displayName: 'Táta', role: 'giver', createdAt: AT, updatedAt: AT })
    .returning()
    .get().id
  const valid = {
    title: 'Vynést koše',
    status: 'proposed' as const,
    score: 4,
    approvalRequired: true,
    scheduleDays: 1 << 2,
    scheduleTime: '18:00',
    dueDayOffset: 1,
    dueTime: '07:00',
    graceMinutes: 120,
    createdBy: giver,
    createdAt: AT,
    updatedAt: AT,
  }
  return { db, giver, valid }
}

describe('templates table', () => {
  it('stores a valid template, and one with no schedule and no deadline', () => {
    const { db, valid } = setup()
    db.insert(templates).values(valid).run()
    db.insert(templates)
      .values({
        ...valid,
        scheduleDays: 0,
        scheduleTime: null,
        dueDayOffset: null,
        dueTime: null,
        graceMinutes: null,
      })
      .run()
    expect(db.select().from(templates).all()).toHaveLength(2)
  })

  it('leaves the upper limits of day offset and grace to the domain, so a [call] change needs no migration', () => {
    const { db, valid } = setup()
    db.insert(templates)
      .values({ ...valid, dueDayOffset: 7, graceMinutes: 2881 })
      .run()
    expect(db.select().from(templates).all()).toHaveLength(1)
  })

  it.each([
    ['a time without days', { scheduleDays: 0 }],
    ['half a deadline', { dueTime: null }],
    ['a deadline with no grace', { graceMinutes: null }],
    ['a negative day offset', { dueDayOffset: -1 }],
    ['negative grace', { graceMinutes: -1 }],
    ['days mask 128', { scheduleDays: 128 }],
    ['score 0', { score: 0 }],
    ['a blank title', { title: '  ' }],
    ['an unknown status', { status: 'agreed' }],
  ])('refuses %s', (_, change) => {
    const { db, valid } = setup()
    expect(() =>
      db
        .insert(templates)
        .values({ ...valid, ...change } as typeof valid)
        .run(),
    ).toThrow(/CHECK constraint/)
  })

  it('one approval per person and template', () => {
    const { db, giver, valid } = setup()
    const id = db.insert(templates).values(valid).returning().get().id
    const row = { templateId: id, userId: giver, score: 4, approvedAt: AT }
    db.insert(templateScoreApprovals).values(row).run()
    expect(() => db.insert(templateScoreApprovals).values(row).run()).toThrow(/UNIQUE|PRIMARY/)
  })
})
