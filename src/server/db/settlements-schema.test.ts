import { describe, expect, it } from 'vitest'
import { family } from '~/server/tasks/testing'
import { periods, settlements } from './schema'

// The DB backs up the settlement rules (spec §5.9): a record that makes no sense can't be
// stored, and a stored record is final.
function setup() {
  const f = family()
  const periodId = f.db
    .insert(periods)
    .values({
      startsAt: '2026-11-22T22:59:00.000Z',
      cutoffAt: '2026-11-29T22:59:00.000Z',
      endedAt: null,
      lowerLevel: 50,
      upperLevel: 100,
      createdAt: '2026-11-22T22:59:00.000Z',
    })
    .returning()
    .get().id
  const valid = {
    periodId,
    takerId: f.starsi,
    totalBefore: 130,
    level: 'upper' as const,
    deducted: 100,
    carryOver: 30,
    settledBy: f.tata,
    settledAt: '2026-11-29T19:00:00.000Z',
  }
  return { ...f, valid }
}

describe('settlements table', () => {
  it('stores a valid record, and a zero one', () => {
    const { db, valid, mladsi } = setup()
    db.insert(settlements).values(valid).run()
    db.insert(settlements)
      .values({
        ...valid,
        takerId: mladsi,
        totalBefore: 0,
        level: 'none',
        deducted: 0,
        carryOver: 0,
      })
      .run()
    expect(db.select().from(settlements).all()).toHaveLength(2)
  })

  it.each([
    ['a negative total', { totalBefore: -1, deducted: 0, carryOver: -1, level: 'none' }],
    ['a negative deduction', { totalBefore: 30, deducted: -50, carryOver: 80, level: 'lower' }],
    ['a negative carry-over', { totalBefore: 30, deducted: 50, carryOver: -20, level: 'lower' }],
    ['carry-over ≠ total − deducted', { totalBefore: 130, deducted: 100, carryOver: 20 }],
  ])('refuses %s', (_, change) => {
    const { db, valid } = setup()
    expect(() =>
      db
        .insert(settlements)
        .values({ ...valid, ...change } as typeof valid)
        .run(),
    ).toThrow(/settlements_points_check/)
  })

  it('refuses an unknown level', () => {
    const { db, valid } = setup()
    expect(() =>
      db
        .insert(settlements)
        .values({ ...valid, level: 'middle' } as unknown as typeof valid)
        .run(),
    ).toThrow(/settlements_level_check/)
  })

  it('refuses a level that does not match the deduction', () => {
    const { db, valid } = setup()
    expect(() =>
      db
        .insert(settlements)
        .values({ ...valid, level: 'none' })
        .run(),
    ).toThrow(/settlements_deducted_check/)
    expect(() =>
      db
        .insert(settlements)
        .values({ ...valid, level: 'lower', deducted: 0, carryOver: 130 })
        .run(),
    ).toThrow(/settlements_deducted_check/)
  })

  it('refuses a second record for the same taker and period', () => {
    const { db, valid } = setup()
    db.insert(settlements).values(valid).run()
    expect(() => db.insert(settlements).values(valid).run()).toThrow(/UNIQUE/)
  })

  it('is final: updates and deletes are rejected', () => {
    const { db, valid } = setup()
    db.insert(settlements).values(valid).run()
    expect(() => db.$client.exec('UPDATE settlements SET deducted = 0')).toThrow(
      /settlements are final/,
    )
    expect(() => db.$client.exec('DELETE FROM settlements')).toThrow(/settlements are final/)
  })
})
