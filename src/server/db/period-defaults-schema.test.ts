import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { periodDefaults } from './schema'
import { createTestDb } from './testing'

// The stored default week (spec §5.8): one row, seeded by its migration with today's defaults.
// The checks back up the domain's `isValidDefaults`, whatever code writes the row.
describe('period_defaults table', () => {
  it('the migration seeds 7 days, Sunday 23:59, 50/100', () => {
    const db = createTestDb()
    const rows = db.select().from(periodDefaults).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 1,
      lengthDays: 7,
      cutoffWeekday: 0,
      cutoffHour: 23,
      cutoffMinute: 59,
      lowerLevel: 50,
      upperLevel: 100,
      updatedBy: null,
    })
  })

  it('a second row is refused (id = 1 check)', () => {
    const db = createTestDb()
    const [row] = db.select().from(periodDefaults).all()
    if (!row) throw new Error('no seed row')
    expect(() =>
      db
        .insert(periodDefaults)
        .values({ ...row, id: 2 })
        .run(),
    ).toThrow(/period_defaults_singleton_check/)
  })

  it.each([
    ['lower > upper', { lowerLevel: 120, upperLevel: 100 }, /period_defaults_levels_check/],
    ['lower 0', { lowerLevel: 0 }, /period_defaults_levels_check/],
    ['length 10', { lengthDays: 10 }, /period_defaults_length_check/],
    ['length 0', { lengthDays: 0 }, /period_defaults_length_check/],
    ['length 371', { lengthDays: 371 }, /period_defaults_length_check/],
    ['weekday 7', { cutoffWeekday: 7 }, /period_defaults_cutoff_check/],
    ['hour 24', { cutoffHour: 24 }, /period_defaults_cutoff_check/],
    ['minute 60', { cutoffMinute: 60 }, /period_defaults_cutoff_check/],
  ])('refuses %s', (_name, change, error) => {
    const db = createTestDb()
    expect(() =>
      db.update(periodDefaults).set(change).where(eq(periodDefaults.id, 1)).run(),
    ).toThrow(error)
  })

  it('accepts the boundaries: 364 days, lower = upper = 1, Saturday 00:00', () => {
    const db = createTestDb()
    db.update(periodDefaults)
      .set({
        lengthDays: 364,
        lowerLevel: 1,
        upperLevel: 1,
        cutoffWeekday: 6,
        cutoffHour: 0,
        cutoffMinute: 0,
      })
      .where(eq(periodDefaults.id, 1))
      .run()
    expect(db.select().from(periodDefaults).get()).toMatchObject({ lengthDays: 364, upperLevel: 1 })
  })
})
